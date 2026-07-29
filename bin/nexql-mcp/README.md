# Vendored nexql-mcp binaries

Layout: `bin/nexql-mcp/<platform>-<arch>/nexql-mcp[.exe]`

Populate via:

```bash
cd mcp && cargo build --release -p nexql-mcp
./scripts/vendor-nexql-mcp.sh
```

CI release builds should vendor per target into the matching platform directory
before `make package-pro`.
