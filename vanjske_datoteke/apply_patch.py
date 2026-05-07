#!/usr/bin/env python3
"""Apply audience mapping patch to eulex-mcp-oauth.php preserving original line endings."""

import sys

filepath = sys.argv[1]

with open(filepath, 'rb') as f:
    content = f.read()

# Detect line ending from original file
if b'\r\n' in content:
    nl = b'\r\n'
else:
    nl = b'\n'

# Read as text using detected line ending
text = content.decode('utf-8')
lines = text.split('\r\n' if nl == b'\r\n' else '\n')

# Build newline string
NL = '\r\n' if nl == b'\r\n' else '\n'

result = []
i = 0
while i < len(lines):
    line = lines[i]

    # PATCH 1: Refresh token grant - add client_id
    if line == '\t\t\t$user_id = (int) $refresh_data[\'user_id\'];' and i+1 < len(lines) and '$scope' in lines[i+1] and 'refresh_data' in lines[i+1]:
        result.append('\t\t\t$user_id   = (int) $refresh_data[\'user_id\'];')
        result.append(lines[i+1])  # keep scope line as-is
        result.append('\t\t\t$client_id = $refresh_data[\'client_id\'] ?? \'\';')
        i += 2
        # Find and replace generate_tokens call
        while i < len(lines):
            if '$new_tokens = eulex_mcp_generate_tokens($user_id, $scope);' in lines[i]:
                result.append(lines[i].replace(
                    'eulex_mcp_generate_tokens($user_id, $scope)',
                    'eulex_mcp_generate_tokens($user_id, $scope, $client_id)'
                ))
                i += 1
                break
            else:
                result.append(lines[i])
                i += 1
        continue

    # PATCH 2: Auth code grant - add client_id
    if line == '\t\t$user_id = (int) $auth_data[\'user_id\'];' and i+1 < len(lines) and '$scope' in lines[i+1] and 'auth_data' in lines[i+1]:
        result.append('\t\t$user_id   = (int) $auth_data[\'user_id\'];')
        result.append(lines[i+1])  # keep scope line as-is
        result.append('\t\t$client_id = $auth_data[\'client_id\'] ?? \'\';')
        i += 2
        # Find and replace generate_tokens call
        while i < len(lines):
            if '$tokens = eulex_mcp_generate_tokens($user_id, $scope);' in lines[i]:
                result.append(lines[i].replace(
                    'eulex_mcp_generate_tokens($user_id, $scope)',
                    'eulex_mcp_generate_tokens($user_id, $scope, $client_id)'
                ))
                i += 1
                break
            else:
                result.append(lines[i])
                i += 1
        continue

    # PATCH 3: Add audience helper + update function signature
    if line == "function eulex_mcp_generate_tokens($user_id, $scope = 'mcp:all') {":
        result.append('// Client ID to audience mapping')
        result.append('function eulex_mcp_get_audience_for_client($client_id) {')
        result.append('\t$map = [')
        result.append("\t\t'mike_default_client' => 'mike',")
        result.append('\t];')
        result.append("\treturn $map[$client_id] ?? 'eulex-mcp';")
        result.append('}')
        result.append('')
        result.append("function eulex_mcp_generate_tokens($user_id, $scope = 'mcp:all', $client_id = '') {")
        i += 1
        continue

    # PATCH 4: Add audience variable before JWT payload
    if line == '\t// Build JWT payload' and i > 0 and '$final_scope' in lines[i-1 if i > 0 else 0]:
        result.append('')
        result.append('\t// Determine audience from client_id')
        result.append('\t$audience = eulex_mcp_get_audience_for_client($client_id);')
        result.append('')
        result.append(line)
        i += 1
        continue

    # PATCH 5: Replace hardcoded audience
    if "\t\t'aud'            => 'eulex-mcp'," in line:
        result.append("\t\t'aud'            => $audience,")
        i += 1
        continue

    # PATCH 6: Add client_id to refresh transient
    if line == "\tset_transient($refresh_key, [" and i+1 < len(lines) and "'user_id'" in lines[i+1] and i+2 < len(lines) and "'scope'" in lines[i+2]:
        result.append(line)
        result.append("\t\t'user_id'   => $user_id,")
        result.append("\t\t'scope'     => $scope,")
        result.append("\t\t'client_id' => $client_id,")
        i += 3  # skip original user_id and scope lines
        continue

    result.append(line)
    i += 1

# Write back with original line endings
output = NL.join(result)
with open(filepath, 'wb') as f:
    f.write(output.encode('utf-8'))

print(f"Patched successfully. {len(lines)} -> {len(result)} lines. Line ending: {'CRLF' if nl == b'\\r\\n' else 'LF'}")
