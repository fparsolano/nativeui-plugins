# NativeUI Codex Tenant Policy Kit

Codex plugin installation makes NativeUI workflows available, but it does not
override enterprise approval, network, or disclosure policy. If Codex denies an
upload to `dev.nativeui.com`, do not retry the same action.

Use one of these approved paths:

1. Ask a ChatGPT/Codex workspace admin to assign
   `codex-requirements.nativeui.example.toml` to the pilot users or group, after
   adapting organization names and any existing requirements.
2. If external upload remains blocked, run an approved internal/self-host
   NativeUI export service and configure:

```json
{
  "exportServiceUrl": "https://nativeui-export.internal.example.com",
  "exportAuthMode": "none"
}
```

Export-only mode is intentionally narrow. It omits NativeUI bearer auth only for
import/export/model-validation calls to the configured export service. NativeUI
cloud save, preview, project sync, library secrets, and parity reporting still
require hosted NativeUI auth.

