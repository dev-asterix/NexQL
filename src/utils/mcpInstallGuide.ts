/** Official Node.js download page — required for `npx -y nexql-mcp@latest`. */
export const NODEJS_DOWNLOAD_URL = 'https://nodejs.org/';

/** Latest nexql-mcp release artifacts. */
export const NEXQL_MCP_RELEASES_URL = 'https://github.com/NexQL-OSS/mcp/releases/latest';

/** `${process.platform}-${process.arch}` → Rust target triple, matching nexql-mcp's release matrix. */
const MCP_RELEASE_TRIPLES: Record<string, string> = {
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

/**
 * Copy-pasteable curl+tar snippet pulling the nexql-mcp release tarball from GitHub.
 * `undefined` for OS/arch combos without prebuilt binaries.
 */
export function buildMcpDownloadCurlCommand(version: string): string | undefined {
  const triple = MCP_RELEASE_TRIPLES[`${process.platform}-${process.arch}`];
  if (!triple) return undefined;
  const tag = `v${version}`;
  const asset = `nexql-mcp-${tag}-${triple}`;
  const baseUrl = `https://github.com/NexQL-OSS/mcp/releases/download/${tag}/${asset}.tar.gz`;
  if (process.platform === 'win32') {
    return (
      `curl.exe -fsSL -o ${asset}.tar.gz ${baseUrl} && ` +
      `tar.exe -xzf ${asset}.tar.gz --strip-components=1 ${asset}/nexql-mcp.exe`
    );
  }
  return `curl -fsSL ${baseUrl} | tar -xz --strip-components=1 -C /usr/local/bin ${asset}/nexql-mcp`;
}
