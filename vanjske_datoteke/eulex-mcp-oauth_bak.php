<?php
/**
 * Plugin Name: EULEX MCP OAuth 2.1
 * Description: OAuth 2.1 Authorization Server for EULEX MCP Server with PKCE + IMP tier integration.
 * Version: 1.0.0
 * Author: EULEX AI
 *
 * Implements:
 *   - RFC 8414: OAuth 2.0 Authorization Server Metadata
 *   - RFC 9728: OAuth 2.0 Protected Resource Metadata
 *   - RFC 7636: PKCE (Proof Key for Code Exchange)
 *   - RFC 7591: Dynamic Client Registration
 *   - JWT Access Tokens with IMP subscription tier claims
 */

if (!defined('ABSPATH')) {
	exit;
}

// =============================================================================
// CONFIG
// =============================================================================

if (!defined('EULEX_MCP_JWT_SECRET')) {
	// MUST be overridden in wp-config.php with a strong 256-bit key
	define('EULEX_MCP_JWT_SECRET', 'CHANGE_ME_IN_WP_CONFIG');
}

if (!defined('EULEX_MCP_JWT_EXPIRY')) {
	define('EULEX_MCP_JWT_EXPIRY', 604800); // 7 days (was 3600 / 1 hour)
}

if (!defined('EULEX_MCP_REFRESH_EXPIRY')) {
	define('EULEX_MCP_REFRESH_EXPIRY', 2592000); // 30 days
}

// IMP Level IDs
define('EULEX_IMP_PLUS_LEVEL_ID', 2);
define('EULEX_IMP_FREE_LEVEL_ID', 3);

// =============================================================================
// JWT HELPERS (HMAC-SHA256, no external deps)
// =============================================================================

function eulex_mcp_base64url_encode($data) {
	return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function eulex_mcp_base64url_decode($data) {
	return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', 3 - (3 + strlen($data)) % 4));
}

function eulex_mcp_jwt_encode($payload) {
	$header = eulex_mcp_base64url_encode(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
	$payload_encoded = eulex_mcp_base64url_encode(json_encode($payload));
	$signature = eulex_mcp_base64url_encode(
		hash_hmac('sha256', "$header.$payload_encoded", EULEX_MCP_JWT_SECRET, true)
	);
	return "$header.$payload_encoded.$signature";
}

function eulex_mcp_jwt_decode($token) {
	$parts = explode('.', $token);
	if (count($parts) !== 3) {
		return null;
	}

	list($header_b64, $payload_b64, $signature_b64) = $parts;

	$expected_sig = eulex_mcp_base64url_encode(
		hash_hmac('sha256', "$header_b64.$payload_b64", EULEX_MCP_JWT_SECRET, true)
	);

	if (!hash_equals($expected_sig, $signature_b64)) {
		return null;
	}

	$payload = json_decode(eulex_mcp_base64url_decode($payload_b64), true);
	if (!$payload || !isset($payload['exp']) || $payload['exp'] < time()) {
		return null;
	}

	return $payload;
}

// =============================================================================
// IMP TIER DETECTION
// =============================================================================

function eulex_mcp_get_user_tier($user_id) {
	if (!class_exists('\\Indeed\\Ihc\\UserSubscriptions')) {
		return ['tier' => 'free', 'level_id' => EULEX_IMP_FREE_LEVEL_ID, 'expires' => null];
	}

	// Check Plus tier first (higher priority)
	$is_plus_active = \Indeed\Ihc\UserSubscriptions::isActive($user_id, EULEX_IMP_PLUS_LEVEL_ID);
	if ($is_plus_active) {
		$sub = \Indeed\Ihc\UserSubscriptions::getOne($user_id, EULEX_IMP_PLUS_LEVEL_ID);
		return [
			'tier'     => 'plus',
			'level_id' => EULEX_IMP_PLUS_LEVEL_ID,
			'expires'  => $sub ? $sub['expire_time'] : null,
		];
	}

	// Default free
	return ['tier' => 'free', 'level_id' => EULEX_IMP_FREE_LEVEL_ID, 'expires' => null];
}

// =============================================================================
// PKCE HELPERS
// =============================================================================

function eulex_mcp_verify_pkce($code_verifier, $code_challenge) {
	$computed = eulex_mcp_base64url_encode(hash('sha256', $code_verifier, true));
	return hash_equals($computed, $code_challenge);
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

add_action('init', function () {
	if (is_admin() || (defined('DOING_AJAX') && DOING_AJAX)) {
		return;
	}

	$path = untrailingslashit(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
	$site_path = untrailingslashit(parse_url(home_url('/'), PHP_URL_PATH));

	// Strip site path prefix for subdirectory installs
	if ($site_path !== '' && strpos($path, $site_path) === 0) {
		$path = substr($path, strlen($site_path));
	}

	// ---------------------------------------------------------------
	// RFC 8414: Authorization Server Metadata
	// ---------------------------------------------------------------
	if ($path === '/.well-known/oauth-authorization-server') {
		$issuer = home_url('/');

		header('Content-Type: application/json');
		header('Access-Control-Allow-Origin: *');
		header('Cache-Control: public, max-age=3600');

		echo json_encode([
			'issuer'                                => $issuer,
			'authorization_endpoint'                => home_url('/eulex-ai/mcp-oauth/authorize'),
			'token_endpoint'                        => home_url('/eulex-ai/mcp-oauth/token'),
			'registration_endpoint'                 => home_url('/eulex-ai/mcp-oauth/register'),
			'revocation_endpoint'                   => home_url('/eulex-ai/mcp-oauth/revoke'),
			'response_types_supported'              => ['code'],
			'grant_types_supported'                 => ['authorization_code', 'refresh_token'],
			'code_challenge_methods_supported'      => ['S256'],
			'token_endpoint_auth_methods_supported' => ['none'],
			'scopes_supported'                      => ['mcp:search', 'mcp:documents', 'mcp:graph', 'mcp:all', 'mcp:plus'],
			'service_documentation'                 => 'https://eulex.ai/landing/faq',
			'logo_uri'                              => 'https://eulex.ai/landing/logo.png',
		], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
		exit;
	}

	// ---------------------------------------------------------------
	// RFC 9728: Protected Resource Metadata
	// ---------------------------------------------------------------
	if ($path === '/.well-known/oauth-protected-resource') {
		header('Content-Type: application/json');
		header('Access-Control-Allow-Origin: *');
		header('Cache-Control: public, max-age=3600');

		echo json_encode([
			'resource'              => 'https://eulex-mcp-server-307385919521.europe-west1.run.app',
			'authorization_servers' => [home_url('/')],
			'scopes_supported'     => ['mcp:search', 'mcp:documents', 'mcp:graph', 'mcp:all', 'mcp:plus'],
			'bearer_methods_supported' => ['header'],
		], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
		exit;
	}

	// ---------------------------------------------------------------
	// RFC 7591: Dynamic Client Registration
	// ---------------------------------------------------------------
	if ($path === '/eulex-ai/mcp-oauth/register' && $_SERVER['REQUEST_METHOD'] === 'POST') {
		header('Content-Type: application/json');
		header('Access-Control-Allow-Origin: *');

		$input = json_decode(file_get_contents('php://input'), true);

		$redirect_uris = $input['redirect_uris'] ?? [];
		$client_name   = sanitize_text_field($input['client_name'] ?? 'MCP Client');

		// Generate unique client_id
		$client_id = 'mcp_' . wp_generate_password(24, false, false);

		// Store in wp_options (lightweight — no extra table needed)
		$clients = get_option('eulex_mcp_oauth_clients', []);
		$clients[$client_id] = [
			'client_name'   => $client_name,
			'redirect_uris' => $redirect_uris,
			'created_at'    => time(),
		];
		update_option('eulex_mcp_oauth_clients', $clients);

		http_response_code(201);
		echo json_encode([
			'client_id'                  => $client_id,
			'client_name'                => $client_name,
			'redirect_uris'              => $redirect_uris,
			'token_endpoint_auth_method' => 'none',
			'grant_types'                => ['authorization_code', 'refresh_token'],
			'response_types'             => ['code'],
		], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
		exit;
	}

	// ---------------------------------------------------------------
	// Authorization Endpoint
	// ---------------------------------------------------------------
	if ($path === '/eulex-ai/mcp-oauth/authorize' && $_SERVER['REQUEST_METHOD'] === 'GET') {
		$client_id      = sanitize_text_field($_GET['client_id'] ?? '');
		$redirect_uri   = esc_url_raw($_GET['redirect_uri'] ?? '');
		$response_type  = sanitize_text_field($_GET['response_type'] ?? '');
		$code_challenge  = sanitize_text_field($_GET['code_challenge'] ?? '');
		$code_challenge_method = sanitize_text_field($_GET['code_challenge_method'] ?? '');
		$state          = sanitize_text_field($_GET['state'] ?? '');
		$scope          = sanitize_text_field($_GET['scope'] ?? 'mcp:all');

		// Validate required params
		if ($response_type !== 'code') {
			wp_die('Invalid response_type. Only "code" is supported.', 'OAuth Error', ['response' => 400]);
		}

		if (empty($code_challenge) || $code_challenge_method !== 'S256') {
			wp_die('PKCE required. code_challenge with S256 method is mandatory.', 'OAuth Error', ['response' => 400]);
		}

		if (empty($redirect_uri)) {
			wp_die('redirect_uri is required.', 'OAuth Error', ['response' => 400]);
		}

		// If user is not logged in, redirect to EULEX sign-in page
		if (!is_user_logged_in()) {
			$return_url = home_url('/eulex-ai/mcp-oauth/authorize?' . http_build_query($_GET));
			$signin_url = home_url('/signin/?redirect_to=' . urlencode($return_url));
			wp_redirect($signin_url);
			exit;
		}

		// User is logged in — check if already approved (skip consent for returning users)
		$user_id = get_current_user_id();
		$approved_clients = get_user_meta($user_id, 'eulex_mcp_approved_clients', true) ?: [];

		if (isset($_GET['approve']) && $_GET['approve'] === 'yes') {
			// User clicked "Authorize" on consent screen
			$approved_clients[$client_id] = time();
			update_user_meta($user_id, 'eulex_mcp_approved_clients', $approved_clients);

			// Generate auth code
			$auth_code = wp_generate_password(48, false, false);
			$transient_key = 'eulex_mcp_authcode_' . hash('sha256', $auth_code);

			set_transient($transient_key, [
				'user_id'        => $user_id,
				'client_id'      => $client_id,
				'redirect_uri'   => $redirect_uri,
				'code_challenge' => $code_challenge,
				'scope'          => $scope,
				'created_at'     => time(),
			], 10 * MINUTE_IN_SECONDS);

			// Redirect back to client with code
			$redirect = add_query_arg([
				'code'  => $auth_code,
				'state' => $state,
			], $redirect_uri);

			wp_redirect($redirect);
			exit;
		}

		if (isset($_GET['approve']) && $_GET['approve'] === 'no') {
			// User denied
			$redirect = add_query_arg([
				'error'             => 'access_denied',
				'error_description' => 'User denied the request.',
				'state'             => $state,
			], $redirect_uri);
			wp_redirect($redirect);
			exit;
		}

		// Auto-approve for returning users
		if (isset($approved_clients[$client_id])) {
			$_GET['approve'] = 'yes';
			// Re-run this handler (will hit the approve=yes branch above)
			do_action('init');
			exit;
		}

		// Show consent screen
		$user = wp_get_current_user();
		$tier_info = eulex_mcp_get_user_tier($user_id);
		$tier_label = $tier_info['tier'] === 'plus' ? 'Plus' : 'Free';

		$approve_url = add_query_arg(['approve' => 'yes'], $_SERVER['REQUEST_URI']);
		$deny_url    = add_query_arg(['approve' => 'no'], $_SERVER['REQUEST_URI']);

		// Render consent page
		header('Content-Type: text/html; charset=utf-8');
		?>
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Authorize EULEX MCP</title>
			<style>
				* { margin: 0; padding: 0; box-sizing: border-box; }
				body {
					font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
					background: #0a0a0a; color: #e5e5e5;
					display: flex; align-items: center; justify-content: center;
					min-height: 100vh; padding: 20px;
				}
				.card {
					background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
					border-radius: 24px; padding: 48px; max-width: 480px; width: 100%;
					backdrop-filter: blur(20px);
				}
				.logo { margin-bottom: 8px; }
				.logo img { height: 36px; width: auto; display: block; }
				.subtitle { color: #888; font-size: 14px; margin-bottom: 32px; }
				.user-info {
					background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
					border-radius: 16px; padding: 16px 20px; margin-bottom: 24px;
				}
				.user-info .name { font-weight: 600; font-size: 16px; }
				.user-info .meta { color: #888; font-size: 13px; margin-top: 4px; }
				.tier-badge {
					display: inline-block; padding: 2px 10px; border-radius: 99px;
					font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
				}
				.tier-free { background: rgba(255,255,255,0.1); color: #aaa; }
				.tier-plus { background: rgba(203,253,93,0.15); color: #cbfd5d; }
				.permissions { margin-bottom: 32px; }
				.permissions h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #666; margin-bottom: 12px; }
				.perm-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 14px; color: #ccc; }
				.perm-dot { width: 6px; height: 6px; border-radius: 50%; background: #cbfd5d; flex-shrink: 0; }
				.actions { display: flex; gap: 12px; }
				.btn {
					flex: 1; padding: 14px; border-radius: 12px; font-size: 15px; font-weight: 600;
					text-align: center; text-decoration: none; cursor: pointer; transition: all 0.2s;
					border: none;
				}
				.btn-approve {
					background: #cbfd5d; color: #000;
					box-shadow: 0 0 20px rgba(203,253,93,0.3);
				}
				.btn-approve:hover { filter: brightness(1.1); box-shadow: 0 0 30px rgba(203,253,93,0.5); }
				.btn-deny { background: rgba(255,255,255,0.08); color: #999; }
				.btn-deny:hover { background: rgba(255,255,255,0.12); color: #ccc; }
				.footer { text-align: center; margin-top: 24px; font-size: 12px; color: #555; }
			</style>
		</head>
		<body>
			<div class="card">
				<div class="logo"><img src="https://eulex.ai/landing/logo.png" alt="EULEX" /></div>
				<div class="subtitle">MCP Server Authorization</div>

				<div class="user-info">
					<div class="name"><?php echo esc_html($user->display_name); ?></div>
					<div class="meta">
						<?php echo esc_html($user->user_email); ?> ·
						<span class="tier-badge tier-<?php echo esc_attr($tier_info['tier']); ?>"><?php echo esc_html($tier_label); ?></span>
					</div>
				</div>

				<div class="permissions">
					<h3>This application will be able to:</h3>
					<div class="perm-item"><div class="perm-dot"></div> Search EU legislation and case law</div>
					<div class="perm-item"><div class="perm-dot"></div> Access document details and sections</div>
					<?php if ($tier_info['tier'] === 'plus'): ?>
					<div class="perm-item"><div class="perm-dot"></div> Explore document relationships and citations</div>
					<div class="perm-item"><div class="perm-dot"></div> Run compliance analysis snapshots</div>
					<?php endif; ?>
				</div>

				<div class="actions">
					<a href="<?php echo esc_url($deny_url); ?>" class="btn btn-deny">Deny</a>
					<a href="<?php echo esc_url($approve_url); ?>" class="btn btn-approve">Authorize</a>
				</div>

				<div class="footer">Powered by EULEX AI · eulex.ai</div>
			</div>
		</body>
		</html>
		<?php
		exit;
	}

	// ---------------------------------------------------------------
	// Token Endpoint
	// ---------------------------------------------------------------
	if ($path === '/eulex-ai/mcp-oauth/token' && $_SERVER['REQUEST_METHOD'] === 'POST') {
		header('Content-Type: application/json');
		header('Access-Control-Allow-Origin: *');
		header('Cache-Control: no-store');

		// Parse both form-encoded and JSON bodies
		$content_type = $_SERVER['CONTENT_TYPE'] ?? '';
		if (strpos($content_type, 'application/json') !== false) {
			$input = json_decode(file_get_contents('php://input'), true) ?: [];
		} else {
			$input = $_POST;
		}

		$grant_type    = sanitize_text_field($input['grant_type'] ?? '');
		$code          = sanitize_text_field($input['code'] ?? '');
		$code_verifier = sanitize_text_field($input['code_verifier'] ?? '');
		$client_id     = sanitize_text_field($input['client_id'] ?? '');
		$refresh_token_input = sanitize_text_field($input['refresh_token'] ?? '');

		// --- Refresh Token Grant ---
		if ($grant_type === 'refresh_token') {
			if (empty($refresh_token_input)) {
				http_response_code(400);
				echo json_encode(['error' => 'invalid_request', 'error_description' => 'refresh_token required.']);
				exit;
			}

			$refresh_key = 'eulex_mcp_refresh_' . hash('sha256', $refresh_token_input);
			$refresh_data = get_transient($refresh_key);

			if (!$refresh_data || empty($refresh_data['user_id'])) {
				http_response_code(400);
				echo json_encode(['error' => 'invalid_grant', 'error_description' => 'Invalid or expired refresh token.']);
				exit;
			}

			// Rotate refresh token
			delete_transient($refresh_key);
			$user_id = (int) $refresh_data['user_id'];
			$scope   = $refresh_data['scope'] ?? 'mcp:all';

			// Generate new tokens
			$new_tokens = eulex_mcp_generate_tokens($user_id, $scope);
			echo json_encode($new_tokens, JSON_UNESCAPED_SLASHES);
			exit;
		}

		// --- Authorization Code Grant ---
		if ($grant_type !== 'authorization_code') {
			http_response_code(400);
			echo json_encode(['error' => 'unsupported_grant_type', 'error_description' => 'Only authorization_code and refresh_token are supported.']);
			exit;
		}

		if (empty($code) || empty($code_verifier)) {
			http_response_code(400);
			echo json_encode(['error' => 'invalid_request', 'error_description' => 'code and code_verifier are required.']);
			exit;
		}

		// Look up auth code
		$transient_key = 'eulex_mcp_authcode_' . hash('sha256', $code);
		$auth_data = get_transient($transient_key);

		if (!$auth_data) {
			http_response_code(400);
			echo json_encode(['error' => 'invalid_grant', 'error_description' => 'Invalid or expired authorization code.']);
			exit;
		}

		// Consume code (one-time use)
		delete_transient($transient_key);

		// Verify PKCE
		if (!eulex_mcp_verify_pkce($code_verifier, $auth_data['code_challenge'])) {
			http_response_code(400);
			echo json_encode(['error' => 'invalid_grant', 'error_description' => 'PKCE verification failed.']);
			exit;
		}

		// Verify code age (10 min max, but transient handles this)
		$user_id = (int) $auth_data['user_id'];
		$scope   = $auth_data['scope'] ?? 'mcp:all';

		// Generate tokens
		$tokens = eulex_mcp_generate_tokens($user_id, $scope);
		echo json_encode($tokens, JSON_UNESCAPED_SLASHES);
		exit;
	}

	// ---------------------------------------------------------------
	// Token Revocation
	// ---------------------------------------------------------------
	if ($path === '/eulex-ai/mcp-oauth/revoke' && $_SERVER['REQUEST_METHOD'] === 'POST') {
		header('Content-Type: application/json');
		header('Access-Control-Allow-Origin: *');

		$input = $_POST;
		$token = sanitize_text_field($input['token'] ?? '');

		if ($token) {
			// Try to delete as refresh token
			$refresh_key = 'eulex_mcp_refresh_' . hash('sha256', $token);
			delete_transient($refresh_key);
		}

		// Always return 200 per RFC 7009
		http_response_code(200);
		echo json_encode(['status' => 'ok']);
		exit;
	}

	// ---------------------------------------------------------------
	// CORS preflight for all mcp-oauth endpoints
	// ---------------------------------------------------------------
	if (strpos($path, '/eulex-ai/mcp-oauth/') === 0 && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
		header('Access-Control-Allow-Origin: *');
		header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
		header('Access-Control-Allow-Headers: Content-Type, Authorization');
		header('Access-Control-Max-Age: 86400');
		http_response_code(204);
		exit;
	}

}, 0);

// =============================================================================
// TOKEN GENERATION
// =============================================================================

function eulex_mcp_generate_tokens($user_id, $scope = 'mcp:all') {
	$user = get_userdata($user_id);
	if (!$user) {
		http_response_code(400);
		echo json_encode(['error' => 'invalid_grant', 'error_description' => 'User not found.']);
		exit;
	}

	$tier_info = eulex_mcp_get_user_tier($user_id);
	$now = time();

	// Inject mcp:plus scope for Plus-tier subscribers
	$scope_parts = array_filter(array_map('trim', explode(' ', $scope)));
	if ($tier_info['tier'] === 'plus' && !in_array('mcp:plus', $scope_parts, true)) {
		$scope_parts[] = 'mcp:plus';
	}
	$final_scope = implode(' ', $scope_parts);

	// Build JWT payload
	$payload = [
		'iss'            => home_url('/'),
		'sub'            => (string) $user_id,
		'email'          => $user->user_email,
		'name'           => $user->display_name,
		'tier'           => $tier_info['tier'],
		'tier_level_id'  => $tier_info['level_id'],
		'tier_expires'   => $tier_info['expires'],
		'scope'          => $final_scope,
		'aud'            => 'eulex-mcp',
		'iat'            => $now,
		'exp'            => $now + EULEX_MCP_JWT_EXPIRY,
	];

	$access_token = eulex_mcp_jwt_encode($payload);

	// Generate opaque refresh token
	$refresh_token = wp_generate_password(64, false, false);
	$refresh_key = 'eulex_mcp_refresh_' . hash('sha256', $refresh_token);

	set_transient($refresh_key, [
		'user_id' => $user_id,
		'scope'   => $scope,
	], EULEX_MCP_REFRESH_EXPIRY);

	return [
		'access_token'  => $access_token,
		'token_type'    => 'Bearer',
		'expires_in'    => EULEX_MCP_JWT_EXPIRY,
		'refresh_token' => $refresh_token,
		'scope'         => $final_scope,
	];
}

// =============================================================================
// REST API: Token verification endpoint (for MCP server to validate tokens)
// =============================================================================

add_action('rest_api_init', function () {
	register_rest_route('eulex-mcp/v1', '/verify-token', [
		'methods'             => 'POST',
		'callback'            => 'eulex_mcp_rest_verify_token',
		'permission_callback' => '__return_true',
	]);
});

function eulex_mcp_rest_verify_token($request) {
	$auth_header = $request->get_header('Authorization');
	if (!$auth_header || strpos($auth_header, 'Bearer ') !== 0) {
		return new WP_REST_Response(['valid' => false, 'error' => 'Missing Bearer token'], 401);
	}

	$token = substr($auth_header, 7);
	$claims = eulex_mcp_jwt_decode($token);

	if (!$claims) {
		return new WP_REST_Response(['valid' => false, 'error' => 'Invalid or expired token'], 401);
	}

	return new WP_REST_Response([
		'valid' => true,
		'sub'   => $claims['sub'],
		'tier'  => $claims['tier'],
		'email' => $claims['email'],
		'scope' => $claims['scope'],
	], 200);
}
