package modelrouting

import (
	"omnillm/internal/providers/types"
	"omnillm/internal/registry"
	"testing"
)

func TestCatalogReplacementDoesNotInheritModels(t *testing.T) {
	id := "catalog-replacement"
	old := &mockProvider{instanceID: id, models: &types.ModelsResponse{Data: []types.Model{{ID: "old"}}}}
	current := &mockProvider{instanceID: id, models: &types.ModelsResponse{Data: []types.Model{{ID: "gpt-6-astra"}}}}
	reg := registry.GetProviderRegistry()
	cache := NewModelCache()
	_ = reg.Register(old, false)
	_, _ = GetCachedOrFetchModels(old, cache)
	_ = reg.Register(current, false)
	got, err := GetCachedOrFetchModels(current, cache)
	if err != nil || len(got.Data) != 1 || got.Data[0].ID != "gpt-6-astra" {
		t.Fatalf("replacement catalog = %+v, error = %v", got, err)
	}
}

func TestEmptyCatalogCanRecover(t *testing.T) {
	p := &mockProvider{instanceID: "catalog-empty", models: &types.ModelsResponse{Object: "list"}}
	cache := NewModelCache()
	_, _ = GetCachedOrFetchModels(p, cache)
	p.models = &types.ModelsResponse{Data: []types.Model{{ID: "gpt-6-astra"}}}
	// A lifecycle change must bypass even a failure backoff.
	_ = registry.GetProviderRegistry().Register(p, false)
	got, err := GetCachedOrFetchModels(p, cache)
	if err != nil || len(got.Data) != 1 {
		t.Fatalf("recovered catalog = %+v, error = %v", got, err)
	}
}

func TestCatalogRenameDeleteAndRecreation(t *testing.T) {
	reg := registry.GetProviderRegistry()
	p := &mockProvider{instanceID: "catalog-old-id", models: &types.ModelsResponse{Data: []types.Model{{ID: "old"}}}}
	cache := NewModelCache()
	_ = reg.Register(p, false)
	_, _ = GetCachedOrFetchModels(p, cache)
	if err := reg.Rename(p.instanceID, "catalog-new-id"); err != nil {
		t.Fatal(err)
	}
	replacement := &mockProvider{instanceID: "catalog-old-id", models: &types.ModelsResponse{Data: []types.Model{{ID: "astra"}}}}
	_ = reg.Register(replacement, false)
	got, err := GetCachedOrFetchModels(replacement, cache)
	if err != nil || got.Data[0].ID != "astra" {
		t.Fatalf("renamed owner inherited %+v %v", got, err)
	}
	if err := reg.Remove(replacement.instanceID); err != nil {
		t.Fatal(err)
	}
	replacement.models = &types.ModelsResponse{Data: []types.Model{{ID: "recreated"}}}
	_ = reg.Register(replacement, false)
	got, err = GetCachedOrFetchModels(replacement, cache)
	if err != nil || got.Data[0].ID != "recreated" {
		t.Fatalf("recreated owner inherited %+v %v", got, err)
	}
	reg.WaitForPendingSaves()
}
