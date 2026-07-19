# Channel Affinity（渠道亲和）设计方案

> 借鉴自 new-api `service/channel_affinity.go`，适配 OmniLLM 的 CIF / providerdispatch 架构。
> 目标：让同一段对话在多次请求间**粘住同一个上游 provider 实例**，最大化 upstream prompt-cache 命中率，直接省钱（尤其 Claude opus / OpenAI 的 cached_tokens 计费）。

## 1. 问题

OmniLLM 当前 `providerdispatch.PrepareCandidates` 拿到 `modelRoute.CandidateProviders`，这个列表由 `SortProvidersByPriority` 按优先级排序（虚拟模型还可能 round-robin / weighted）。**每次请求都可能落到不同实例**。

而 Anthropic / OpenAI 的 prompt cache 是**按 provider 账号/实例**维护的：
- 同一段 5-hop 的 agent 对话，第 2 轮如果换了实例 → 前缀 cache 全部 miss → 重新按 full-price 计 input tokens。
- 对 James 的 coding-agent（Claude Code / Codex）高频多轮场景，这是持续的隐性浪费。

## 2. 核心思路（与 new-api 的差异）

new-api 用**可配置规则**从 header/gjson/context 提取一个「亲和 key」（面向多租户平台）。
OmniLLM 是个人/团队控制平面，更简单也更准的键是：

> **affinityKey = hash(model + userId? + system + messages[0])** —— 对话的「稳定头部」。

**最终实现采用「稳定头部」而非「滑动前缀」**，原因（实现时发现的关键点）：
- 真实请求永远以 **user message 结尾**，而「除最后一条外的前缀」永远以 **assistant reply 结尾** → 两者哈希永不相等，滑动前缀方案 lookup 永远 miss（已被单测证伪）。
- 对话的第一条消息（+system）在**每一轮都相同**，正是 upstream prompt-cache 命中的公共前缀。用它做键，一条对话整个生命周期稳定粘同一实例，且第 1 轮就能记录、第 2 轮起命中。
- 碰撞是良性的：两条不同对话若头部完全相同 → 哈希相同 → 优先同一实例，而它们本就共享可缓存前缀，正合期望。亲和只影响候选**排序**，碰撞永不损害正确性。

## 3. 数据结构

复用现有内存 KV（`internal/database/store_cache.go` 已有 cache store），无需引 Redis。

```
type AffinityCache interface {
    Get(key string) (instanceID string, ok bool)
    Put(key, instanceID string, ttl time.Duration)
}
```
- LRU + TTL（默认 capacity 50_000，TTL 30min，可配）。
- key 格式：`affinity:v1:<requestedModel>:<userId|->:<prefixHash>`。
- prefixHash：`sha256(canonicalize(system, historyMessages))[:16]`。

## 4. 滑动前缀写入（关键，保证多轮持续命中）

单纯哈希「全部 history」只能让第 N 轮命中第 N-1 轮写的键。为覆盖分支/并发/乱序，写入时对**多个前缀边界**都落键指向选中实例：

- 命中读取：用当前请求的 full-history 前缀哈希查。
- 成功响应后写入：不仅写 full-history 键，也写 full-history+本轮(user,assistant) 的键（即「下一轮会用的前缀」），这样下一轮直接命中。

实现上最省事：**响应成功后，用 `system + 本次请求的全部 messages（含刚补上的 assistant 回复）` 算前缀哈希写入** → 精确等于下一轮请求的历史前缀。

## 5. 集成点（改动面很小）

**读**：`providerdispatch/prepare.go::PrepareCandidates`
在 `modelRoute.CandidateProviders` 拿到后、`BuildCandidate` 之前，插入重排序：
```go
if inst, ok := affinity.Lookup(request, attempt.RequestedModel); ok {
    candidateProviders = moveToFront(candidateProviders, inst) // 命中实例提到首位
}
```
- 若命中实例已不在候选列表（下线/被禁）→ 忽略，走正常排序。fallback 语义完全不变（命中只是「优先」，不是「锁定」）。

**写**：在 dispatch 成功（拿到非错误响应）的收尾处（`executor.go` 或 route 层 `chat.go` 成功分支）：
```go
affinity.Record(request, requestedModel, chosenInstanceID)
```

## 6. 配置（config.yaml 新增块）

```yaml
routing:
  affinity:
    enabled: true          # 默认 true
    ttl: 30m
    max_entries: 50000
    include_user_id: true  # 客户端传了 userId 时纳入键
```

## 7. 可观测性

- admin metering / status 加一个 affinity 命中率指标：`hits / (hits+miss)`。
- 每条 route log 带 `affinity_hit: true/false` + `affinity_instance`，方便验证省钱效果。

## 8. 不抄 new-api 的部分

- ❌ 可配置 regex/gjson 规则引擎（多租户平台才需要，个人控制平面过度设计）。
- ❌ Redis 混合缓存（单实例内存 LRU 足够；如果将来多副本部署再加）。
- ❌ param template / channel override 合并逻辑。

## 9. 落地步骤

1. `internal/lib/affinity/affinity.go`：LRU+TTL cache + `Lookup/Record` + 前缀哈希（canonicalize 复用 CIF 序列化）。
2. `prepare.go` 注入 moveToFront（读）。
3. 成功分支调用 `Record`（写）。
4. config 解析 + 默认值。
5. 单测：多轮对话连续命中、fallback 不受影响、命中实例下线降级、跨模型不串味。
6. metering 命中率指标 + route log 字段。

预期 diff：新增 ~250 行（含测试），改动现有文件 <30 行。风险低——命中只影响候选**排序**，永不改变 fallback 正确性。
