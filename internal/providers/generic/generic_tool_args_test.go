package generic

import (
	"reflect"
	"testing"
)

func TestNormalizeToolArguments(t *testing.T) {
	tests := []struct {
		name string
		raw  interface{}
		want map[string]interface{}
	}{
		{
			name: "object preserved",
			raw:  map[string]interface{}{"path": "/tmp/logs"},
			want: map[string]interface{}{"path": "/tmp/logs"},
		},
		{
			name: "json object string parsed",
			raw:  `{"path":"/tmp/logs"}`,
			want: map[string]interface{}{"path": "/tmp/logs"},
		},
		{
			name: "array wrapped as items",
			raw:  []interface{}{"a", "b"},
			want: map[string]interface{}{"items": []interface{}{"a", "b"}},
		},
		{
			name: "plain string wrapped as value",
			raw:  "plain-text",
			want: map[string]interface{}{"value": "plain-text"},
		},
		{
			name: "nil becomes empty object",
			raw:  nil,
			want: map[string]interface{}{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeToolArguments(tt.raw)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("normalizeToolArguments() = %#v, want %#v", got, tt.want)
			}
		})
	}
}
