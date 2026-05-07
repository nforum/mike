<?php
/**
 * Plugin Name: EULEX Social Auth
 * Description: Custom Google and LinkedIn OAuth login for EULEX without UMP social login.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
	exit;
}

/**
 * =============================================================================
 * CONFIG — GOOGLE
 * =============================================================================
 */

if (!defined('EULEX_GOOGLE_CLIENT_ID')) {
	define('EULEX_GOOGLE_CLIENT_ID', 'PASTE_GOOGLE_CLIENT_ID_HERE');
}

if (!defined('EULEX_GOOGLE_CLIENT_SECRET')) {
	define('EULEX_GOOGLE_CLIENT_SECRET', 'PASTE_GOOGLE_CLIENT_SECRET_HERE');
}

if (!defined('EULEX_GOOGLE_DEFAULT_REDIRECT')) {
	define('EULEX_GOOGLE_DEFAULT_REDIRECT', '/eulex-ai/');
}

/**
 * =============================================================================
 * CONFIG — LINKEDIN
 * =============================================================================
 */

if (!defined('EULEX_LINKEDIN_CLIENT_ID')) {
	define('EULEX_LINKEDIN_CLIENT_ID', 'PASTE_LINKEDIN_CLIENT_ID_HERE');
}

if (!defined('EULEX_LINKEDIN_CLIENT_SECRET')) {
	define('EULEX_LINKEDIN_CLIENT_SECRET', 'PASTE_LINKEDIN_CLIENT_SECRET_HERE');
}

if (!defined('EULEX_LINKEDIN_DEFAULT_REDIRECT')) {
	define('EULEX_LINKEDIN_DEFAULT_REDIRECT', '/eulex-ai/');
}

if (!defined('EULEX_TERMS_VERSION')) {
	define('EULEX_TERMS_VERSION', '2025-01-01');
}

/**
 * =============================================================================
 * SHARED HELPERS
 * =============================================================================
 */

function eulex_social_current_path() {
	$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
	return untrailingslashit($path ?: '/');
}

function eulex_social_generate_state() {
	return wp_generate_password(48, false, false);
}

function eulex_social_generate_username($email, $given_name = '', $family_name = '') {
	$parts        = explode('@', $email);
	$email_prefix = sanitize_user(strtolower((string) ($parts[0] ?? '')), true);
	$base         = $email_prefix;

	if (empty($base) && ($given_name || $family_name)) {
		$base = sanitize_user(strtolower(trim($given_name . '.' . $family_name)), true);
	}

	if (empty($base)) {
		$base = 'user';
	}

	$username = $base;
	$i        = 1;

	while (username_exists($username)) {
		$username = $base . '_' . $i;
		$i++;
	}

	return $username;
}

function eulex_social_mark_user_verified($user_id, $method) {
	update_user_meta($user_id, 'email_verified', '1');
	update_user_meta($user_id, 'email_verified_at', current_time('mysql'));
	update_user_meta($user_id, 'email_verification_method', $method);
	delete_user_meta($user_id, 'email_verification_token');
	delete_user_meta($user_id, 'email_verification_token_expires');
}

function eulex_social_assign_default_membership($user_id) {
	if (function_exists('eulex_assign_ump_membership')) {
		eulex_assign_ump_membership($user_id, 'Eulex FREE');
	}
}

function eulex_social_log_acceptance($user_id, $method) {
	$existing_version = get_user_meta($user_id, 'terms_version', true);

	if ($existing_version === EULEX_TERMS_VERSION) {
		return; // already accepted this version, skip
	}

	update_user_meta($user_id, 'terms_accepted_at', current_time('mysql'));
	update_user_meta($user_id, 'terms_version', EULEX_TERMS_VERSION);
	update_user_meta($user_id, 'acceptance_method', sanitize_text_field($method));
	update_user_meta($user_id, 'acceptance_ip', sanitize_text_field($_SERVER['REMOTE_ADDR'] ?? ''));
	update_user_meta($user_id, 'acceptance_ua', sanitize_text_field(substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 512)));
	// privacy_notice_shown_at intentionally not logged — entry point is not yet gated
}

function eulex_social_login_user($user_id, $redirect_to) {
	$user = get_userdata($user_id);

	if (!$user) {
		wp_die('User not found.');
	}

	wp_set_current_user($user_id);
	wp_set_auth_cookie($user_id, true, is_ssl());
	do_action('wp_login', $user->user_login, $user);

	wp_safe_redirect($redirect_to);
	exit;
}

function eulex_social_get_redirect_target($default_constant) {
	$default = home_url(constant($default_constant));

	if (empty($_GET['redirect_to'])) {
		return $default;
	}

	$raw       = wp_unslash($_GET['redirect_to']);
	$validated = wp_validate_redirect($raw, $default);

	return $validated ?: $default;
}

/**
 * =============================================================================
 * GOOGLE — HELPERS
 * =============================================================================
 */

function eulex_google_callback_url() {
	return home_url('/google-auth-callback/');
}

function eulex_google_state_transient_key($state) {
	return 'eulex_google_oauth_state_' . hash('sha256', $state);
}

function eulex_google_set_state_cookie($state) {
	setcookie('eulex_google_oauth_state', $state, [
		'expires'  => time() + 15 * MINUTE_IN_SECONDS,
		'path'     => '/',
		'domain'   => '',
		'secure'   => is_ssl(),
		'httponly' => true,
		'samesite' => 'Lax',
	]);
}

function eulex_google_clear_state_cookie() {
	setcookie('eulex_google_oauth_state', '', [
		'expires'  => time() - 3600,
		'path'     => '/',
		'domain'   => '',
		'secure'   => is_ssl(),
		'httponly' => true,
		'samesite' => 'Lax',
	]);
}

function eulex_google_build_auth_url($state) {
	$params = [
		'client_id'     => EULEX_GOOGLE_CLIENT_ID,
		'redirect_uri'  => eulex_google_callback_url(),
		'response_type' => 'code',
		'scope'         => 'openid email profile',
		'state'         => $state,
		'access_type'   => 'online',
		'prompt'        => 'select_account',
	];

	return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
}

function eulex_google_exchange_code_for_token($code) {
	$response = wp_remote_post('https://oauth2.googleapis.com/token', [
		'timeout' => 20,
		'body'    => [
			'code'          => $code,
			'client_id'     => EULEX_GOOGLE_CLIENT_ID,
			'client_secret' => EULEX_GOOGLE_CLIENT_SECRET,
			'redirect_uri'  => eulex_google_callback_url(),
			'grant_type'    => 'authorization_code',
		],
	]);

	if (is_wp_error($response)) {
		return $response;
	}

	$status = wp_remote_retrieve_response_code($response);
	$body   = json_decode(wp_remote_retrieve_body($response), true);

	if ($status !== 200 || empty($body['access_token'])) {
		return new WP_Error('google_token_exchange_failed', 'Google token exchange failed.', [
			'status' => $status,
			'body'   => $body,
		]);
	}

	return $body;
}

function eulex_google_fetch_userinfo($access_token) {
	$response = wp_remote_get('https://openidconnect.googleapis.com/v1/userinfo', [
		'timeout' => 20,
		'headers' => ['Authorization' => 'Bearer ' . $access_token],
	]);

	if (is_wp_error($response)) {
		return $response;
	}

	$status = wp_remote_retrieve_response_code($response);
	$body   = json_decode(wp_remote_retrieve_body($response), true);

	if ($status !== 200 || empty($body['sub']) || empty($body['email'])) {
		return new WP_Error('google_userinfo_failed', 'Google userinfo request failed.', [
			'status' => $status,
			'body'   => $body,
		]);
	}

	return $body;
}

function eulex_google_attach_identity($user_id, $google_user) {
	update_user_meta($user_id, 'eulex_google_sub', sanitize_text_field($google_user['sub']));
	update_user_meta($user_id, 'eulex_google_email', sanitize_email($google_user['email']));
	update_user_meta($user_id, 'eulex_social_provider', 'google');
	update_user_meta($user_id, 'ihc_goo', sanitize_text_field($google_user['sub']));
}

function eulex_google_find_user_by_sub($sub) {
	$users = get_users([
		'number'     => 1,
		'meta_key'   => 'eulex_google_sub',
		'meta_value' => $sub,
		'fields'     => 'all',
	]);

	return !empty($users) ? $users[0] : null;
}

function eulex_google_resolve_or_create_user($google_user, $context = 'register') {
	$sub            = sanitize_text_field($google_user['sub']);
	$email          = sanitize_email($google_user['email']);
	$email_verified = !empty($google_user['email_verified']);
	$given_name     = sanitize_text_field($google_user['given_name'] ?? '');
	$family_name    = sanitize_text_field($google_user['family_name'] ?? '');
	$display_name   = sanitize_text_field($google_user['name'] ?? trim($given_name . ' ' . $family_name));

	if (!$email || !$email_verified) {
		return new WP_Error('google_email_not_verified', 'Google account email is not verified.');
	}

	// 1. Existing user by Google sub
	$user = eulex_google_find_user_by_sub($sub);
	if ($user instanceof WP_User) {
		eulex_social_mark_user_verified($user->ID, 'google_oidc');
		return $user->ID;
	}

	// 2. Existing user by email — link Google identity
	$user = get_user_by('email', $email);
	if ($user instanceof WP_User) {
		eulex_google_attach_identity($user->ID, $google_user);
		eulex_social_mark_user_verified($user->ID, 'google_oidc');
		eulex_social_assign_default_membership($user->ID);
		eulex_social_log_acceptance($user->ID, 'google_oidc_link');
		return $user->ID;
	}

	// 3. No account exists — only create if context=register
	if ($context !== 'register') {
		return new WP_Error('social_no_account', 'No EULEX account found for this Google account.');
	}

	$username = eulex_social_generate_username($email, $given_name, $family_name);
	$password = wp_generate_password(32, true, true);
	$user_id  = wp_create_user($username, $password, $email);

	if (is_wp_error($user_id)) {
		return $user_id;
	}

	wp_update_user([
		'ID'           => $user_id,
		'first_name'   => $given_name,
		'last_name'    => $family_name,
		'display_name' => $display_name ?: $email,
	]);

	$user = new WP_User($user_id);
	$user->set_role('subscriber');

	eulex_google_attach_identity($user_id, $google_user);
	eulex_social_mark_user_verified($user_id, 'google_oidc');
	eulex_social_assign_default_membership($user_id);
	eulex_social_log_acceptance($user_id, 'google_oidc');

	return $user_id;
}

/**
 * =============================================================================
 * LINKEDIN — HELPERS
 * =============================================================================
 */

function eulex_linkedin_callback_url() {
	return home_url('/linkedin-auth-callback/');
}

function eulex_linkedin_state_transient_key($state) {
	return 'eulex_linkedin_oauth_state_' . hash('sha256', $state);
}

function eulex_linkedin_set_state_cookie($state) {
	setcookie('eulex_linkedin_oauth_state', $state, [
		'expires'  => time() + 15 * MINUTE_IN_SECONDS,
		'path'     => '/',
		'domain'   => '',
		'secure'   => is_ssl(),
		'httponly' => true,
		'samesite' => 'Lax',
	]);
}

function eulex_linkedin_clear_state_cookie() {
	setcookie('eulex_linkedin_oauth_state', '', [
		'expires'  => time() - 3600,
		'path'     => '/',
		'domain'   => '',
		'secure'   => is_ssl(),
		'httponly' => true,
		'samesite' => 'Lax',
	]);
}

function eulex_linkedin_build_auth_url($state) {
	$params = [
		'response_type' => 'code',
		'client_id'     => EULEX_LINKEDIN_CLIENT_ID,
		'redirect_uri'  => eulex_linkedin_callback_url(),
		'state'         => $state,
		'scope'         => 'openid email profile',
	];

	return 'https://www.linkedin.com/oauth/v2/authorization?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
}

function eulex_linkedin_exchange_code_for_token($code) {
	$response = wp_remote_post('https://www.linkedin.com/oauth/v2/accessToken', [
		'timeout' => 20,
		'headers' => ['Content-Type' => 'application/x-www-form-urlencoded'],
		'body'    => [
			'grant_type'    => 'authorization_code',
			'code'          => $code,
			'client_id'     => EULEX_LINKEDIN_CLIENT_ID,
			'client_secret' => EULEX_LINKEDIN_CLIENT_SECRET,
			'redirect_uri'  => eulex_linkedin_callback_url(),
		],
	]);

	if (is_wp_error($response)) {
		return $response;
	}

	$status = wp_remote_retrieve_response_code($response);
	$body   = json_decode(wp_remote_retrieve_body($response), true);

	if ($status !== 200 || empty($body['access_token'])) {
		return new WP_Error('linkedin_token_exchange_failed', 'LinkedIn token exchange failed.', [
			'status' => $status,
			'body'   => $body,
		]);
	}

	return $body;
}

function eulex_linkedin_fetch_userinfo($access_token) {
	$response = wp_remote_get('https://api.linkedin.com/v2/userinfo', [
		'timeout' => 20,
		'headers' => ['Authorization' => 'Bearer ' . $access_token],
	]);

	if (is_wp_error($response)) {
		return $response;
	}

	$status = wp_remote_retrieve_response_code($response);
	$body   = json_decode(wp_remote_retrieve_body($response), true);

	if ($status !== 200 || empty($body['sub']) || empty($body['email'])) {
		return new WP_Error('linkedin_userinfo_failed', 'LinkedIn userinfo request failed.', [
			'status' => $status,
			'body'   => $body,
		]);
	}

	return $body;
}

function eulex_linkedin_attach_identity($user_id, $linkedin_user) {
	update_user_meta($user_id, 'eulex_linkedin_sub', sanitize_text_field($linkedin_user['sub']));
	update_user_meta($user_id, 'eulex_linkedin_email', sanitize_email($linkedin_user['email']));
	update_user_meta($user_id, 'eulex_social_provider', 'linkedin');
	update_user_meta($user_id, 'ihc_in', sanitize_text_field($linkedin_user['sub']));
}

function eulex_linkedin_find_user_by_sub($sub) {
	$users = get_users([
		'number'     => 1,
		'meta_key'   => 'eulex_linkedin_sub',
		'meta_value' => $sub,
		'fields'     => 'all',
	]);

	return !empty($users) ? $users[0] : null;
}

function eulex_linkedin_resolve_or_create_user($linkedin_user, $context = 'register') {
	$sub            = sanitize_text_field($linkedin_user['sub']);
	$email          = sanitize_email($linkedin_user['email']);
	$email_verified = !empty($linkedin_user['email_verified']);
	$given_name     = sanitize_text_field($linkedin_user['given_name'] ?? '');
	$family_name    = sanitize_text_field($linkedin_user['family_name'] ?? '');
	$display_name   = sanitize_text_field($linkedin_user['name'] ?? trim($given_name . ' ' . $family_name));

	if (!$email || !$email_verified) {
		return new WP_Error('linkedin_email_not_verified', 'LinkedIn account email is not verified.');
	}

	// 1. Existing user by LinkedIn sub
	$user = eulex_linkedin_find_user_by_sub($sub);
	if ($user instanceof WP_User) {
		eulex_social_mark_user_verified($user->ID, 'linkedin_oidc');
		return $user->ID;
	}

	// 2. Existing user by email — link LinkedIn identity
	$user = get_user_by('email', $email);
	if ($user instanceof WP_User) {
		eulex_linkedin_attach_identity($user->ID, $linkedin_user);
		eulex_social_mark_user_verified($user->ID, 'linkedin_oidc');
		eulex_social_assign_default_membership($user->ID);
		eulex_social_log_acceptance($user->ID, 'linkedin_oidc_link');
		return $user->ID;
	}

	// 3. No account exists — only create if context=register
	if ($context !== 'register') {
		return new WP_Error('social_no_account', 'No EULEX account found for this LinkedIn account.');
	}

	$username = eulex_social_generate_username($email, $given_name, $family_name);
	$password = wp_generate_password(32, true, true);
	$user_id  = wp_create_user($username, $password, $email);

	if (is_wp_error($user_id)) {
		return $user_id;
	}

	wp_update_user([
		'ID'           => $user_id,
		'first_name'   => $given_name,
		'last_name'    => $family_name,
		'display_name' => $display_name ?: $email,
	]);

	$user = new WP_User($user_id);
	$user->set_role('subscriber');

	eulex_linkedin_attach_identity($user_id, $linkedin_user);
	eulex_social_mark_user_verified($user_id, 'linkedin_oidc');
	eulex_social_assign_default_membership($user_id);
	eulex_social_log_acceptance($user_id, 'linkedin_oidc');

	return $user_id;
}

/**
 * =============================================================================
 * PREVENT LANDING/CANONICAL FROM EATING AUTH ROUTES
 * =============================================================================
 */

add_action('template_redirect', function () {
	$path = eulex_social_current_path();

	$paths = [
		untrailingslashit(parse_url(home_url('/google-auth-start/'),     PHP_URL_PATH)),
		untrailingslashit(parse_url(home_url('/google-auth-callback/'),  PHP_URL_PATH)),
		untrailingslashit(parse_url(home_url('/linkedin-auth-start/'),   PHP_URL_PATH)),
		untrailingslashit(parse_url(home_url('/linkedin-auth-callback/'), PHP_URL_PATH)),
	];

	if (in_array($path, $paths, true)) {
		return;
	}
}, 0);

/**
 * =============================================================================
 * CUSTOM ROUTES
 * =============================================================================
 */

add_action('init', function () {
	if (is_admin() || (defined('DOING_AJAX') && DOING_AJAX)) {
		return;
	}

	$path = eulex_social_current_path();

	$google_start    = untrailingslashit(parse_url(home_url('/google-auth-start/'),     PHP_URL_PATH));
	$google_callback = untrailingslashit(parse_url(home_url('/google-auth-callback/'),  PHP_URL_PATH));
	$linkedin_start  = untrailingslashit(parse_url(home_url('/linkedin-auth-start/'),   PHP_URL_PATH));
	$linkedin_callback = untrailingslashit(parse_url(home_url('/linkedin-auth-callback/'), PHP_URL_PATH));

	// ------------------------------------------------------------------
	// GOOGLE START
	// ------------------------------------------------------------------
	if ($path === $google_start) {
		if (
			empty(EULEX_GOOGLE_CLIENT_ID) ||
			empty(EULEX_GOOGLE_CLIENT_SECRET) ||
			EULEX_GOOGLE_CLIENT_ID === 'PASTE_GOOGLE_CLIENT_ID_HERE' ||
			EULEX_GOOGLE_CLIENT_SECRET === 'PASTE_GOOGLE_CLIENT_SECRET_HERE'
		) {
			wp_die('Google OAuth is not configured.');
		}

		$raw_context = isset($_GET['context']) ? sanitize_text_field(wp_unslash($_GET['context'])) : '';
		if (!in_array($raw_context, ['login', 'register'], true)) {
			wp_safe_redirect(home_url('/signin?social=google_invalid_context'));
			exit;
		}

		$state       = eulex_social_generate_state();
		$redirect_to = eulex_social_get_redirect_target('EULEX_GOOGLE_DEFAULT_REDIRECT');

		set_transient(eulex_google_state_transient_key($state), [
			'redirect_to' => $redirect_to,
			'context'     => $raw_context,
			'created_at'  => time(),
			'ip_hash'     => hash('sha256', $_SERVER['REMOTE_ADDR'] ?? ''),
			'ua_hash'     => hash('sha256', $_SERVER['HTTP_USER_AGENT'] ?? ''),
		], 15 * MINUTE_IN_SECONDS);

		eulex_google_set_state_cookie($state);
		wp_redirect(eulex_google_build_auth_url($state));
		exit;
	}

	// ------------------------------------------------------------------
	// GOOGLE CALLBACK
	// ------------------------------------------------------------------
	if ($path === $google_callback) {
		$state = isset($_GET['state']) ? sanitize_text_field(wp_unslash($_GET['state'])) : '';
		$code  = isset($_GET['code'])  ? sanitize_text_field(wp_unslash($_GET['code']))  : '';
		$error = isset($_GET['error']) ? sanitize_text_field(wp_unslash($_GET['error'])) : '';

		if ($error) {
			error_log('EULEX Google callback error: ' . $error);
			wp_safe_redirect(home_url('/signin?social=google_error'));
			exit;
		}

		if (!$state || !$code) {
			error_log('EULEX Google callback missing state/code.');
			wp_safe_redirect(home_url('/signin?social=google_invalid_callback'));
			exit;
		}

		$cookie_state = isset($_COOKIE['eulex_google_oauth_state'])
			? sanitize_text_field(wp_unslash($_COOKIE['eulex_google_oauth_state']))
			: '';

		$stored = get_transient(eulex_google_state_transient_key($state));

		if (!$cookie_state || !hash_equals($cookie_state, $state) || empty($stored)) {
			error_log('EULEX Google state validation failed.');
			wp_safe_redirect(home_url('/signin?social=google_state_failed'));
			exit;
		}

		delete_transient(eulex_google_state_transient_key($state));
		eulex_google_clear_state_cookie();

		$token_data = eulex_google_exchange_code_for_token($code);
		if (is_wp_error($token_data)) {
			error_log('EULEX Google token error: ' . print_r($token_data->get_error_data(), true));
			wp_safe_redirect(home_url('/signin?social=google_token_failed'));
			exit;
		}

		$userinfo = eulex_google_fetch_userinfo($token_data['access_token']);
		if (is_wp_error($userinfo)) {
			error_log('EULEX Google userinfo error: ' . print_r($userinfo->get_error_data(), true));
			wp_safe_redirect(home_url('/signin?social=google_userinfo_failed'));
			exit;
		}

		if (!isset($stored['context']) || !in_array($stored['context'], ['login', 'register'], true)) {
			error_log('EULEX Google callback: missing or invalid context in state transient.');
			wp_safe_redirect(home_url('/signin?social=google_invalid_context'));
			exit;
		}
		$context = $stored['context'];

		$user_id = eulex_google_resolve_or_create_user($userinfo, $context);
		if (is_wp_error($user_id)) {
			if ($user_id->get_error_code() === 'social_no_account') {
				wp_safe_redirect(home_url('/signin?social=google&hint=no_account'));
			} else {
				error_log('EULEX Google user resolve/create error: ' . $user_id->get_error_message());
				wp_safe_redirect(home_url('/signin?social=google_user_failed'));
			}
			exit;
		}

		$redirect_to = !empty($stored['redirect_to'])
			? wp_validate_redirect($stored['redirect_to'], home_url(EULEX_GOOGLE_DEFAULT_REDIRECT))
			: home_url(EULEX_GOOGLE_DEFAULT_REDIRECT);

		eulex_social_login_user((int) $user_id, $redirect_to);
	}

	// ------------------------------------------------------------------
	// LINKEDIN START
	// ------------------------------------------------------------------
	if ($path === $linkedin_start) {
		if (
			empty(EULEX_LINKEDIN_CLIENT_ID) ||
			empty(EULEX_LINKEDIN_CLIENT_SECRET) ||
			EULEX_LINKEDIN_CLIENT_ID === 'PASTE_LINKEDIN_CLIENT_ID_HERE' ||
			EULEX_LINKEDIN_CLIENT_SECRET === 'PASTE_LINKEDIN_CLIENT_SECRET_HERE'
		) {
			wp_die('LinkedIn OAuth is not configured.');
		}

		$raw_context = isset($_GET['context']) ? sanitize_text_field(wp_unslash($_GET['context'])) : '';
		if (!in_array($raw_context, ['login', 'register'], true)) {
			wp_safe_redirect(home_url('/signin?social=linkedin_invalid_context'));
			exit;
		}

		$state       = eulex_social_generate_state();
		$redirect_to = eulex_social_get_redirect_target('EULEX_LINKEDIN_DEFAULT_REDIRECT');

		set_transient(eulex_linkedin_state_transient_key($state), [
			'redirect_to' => $redirect_to,
			'context'     => $raw_context,
			'created_at'  => time(),
			'ip_hash'     => hash('sha256', $_SERVER['REMOTE_ADDR'] ?? ''),
			'ua_hash'     => hash('sha256', $_SERVER['HTTP_USER_AGENT'] ?? ''),
		], 15 * MINUTE_IN_SECONDS);

		eulex_linkedin_set_state_cookie($state);
		wp_redirect(eulex_linkedin_build_auth_url($state));
		exit;
	}

	// ------------------------------------------------------------------
	// LINKEDIN CALLBACK
	// ------------------------------------------------------------------
	if ($path === $linkedin_callback) {
		$state = isset($_GET['state']) ? sanitize_text_field(wp_unslash($_GET['state'])) : '';
		$code  = isset($_GET['code'])  ? sanitize_text_field(wp_unslash($_GET['code']))  : '';
		$error = isset($_GET['error']) ? sanitize_text_field(wp_unslash($_GET['error'])) : '';

		if ($error) {
			error_log('EULEX LinkedIn callback error: ' . $error);
			wp_safe_redirect(home_url('/signin?social=linkedin_error'));
			exit;
		}

		if (!$state || !$code) {
			error_log('EULEX LinkedIn callback missing state/code.');
			wp_safe_redirect(home_url('/signin?social=linkedin_invalid_callback'));
			exit;
		}

		$cookie_state = isset($_COOKIE['eulex_linkedin_oauth_state'])
			? sanitize_text_field(wp_unslash($_COOKIE['eulex_linkedin_oauth_state']))
			: '';

		$stored = get_transient(eulex_linkedin_state_transient_key($state));

		if (!$cookie_state || !hash_equals($cookie_state, $state) || empty($stored)) {
			error_log('EULEX LinkedIn state validation failed.');
			wp_safe_redirect(home_url('/signin?social=linkedin_state_failed'));
			exit;
		}

		delete_transient(eulex_linkedin_state_transient_key($state));
		eulex_linkedin_clear_state_cookie();

		$token_data = eulex_linkedin_exchange_code_for_token($code);
		if (is_wp_error($token_data)) {
			error_log('EULEX LinkedIn token error: ' . print_r($token_data->get_error_data(), true));
			wp_safe_redirect(home_url('/signin?social=linkedin_token_failed'));
			exit;
		}

		$userinfo = eulex_linkedin_fetch_userinfo($token_data['access_token']);
		if (is_wp_error($userinfo)) {
			error_log('EULEX LinkedIn userinfo error: ' . print_r($userinfo->get_error_data(), true));
			wp_safe_redirect(home_url('/signin?social=linkedin_userinfo_failed'));
			exit;
		}

		if (!isset($stored['context']) || !in_array($stored['context'], ['login', 'register'], true)) {
			error_log('EULEX LinkedIn callback: missing or invalid context in state transient.');
			wp_safe_redirect(home_url('/signin?social=linkedin_invalid_context'));
			exit;
		}
		$context = $stored['context'];

		$user_id = eulex_linkedin_resolve_or_create_user($userinfo, $context);
		if (is_wp_error($user_id)) {
			if ($user_id->get_error_code() === 'social_no_account') {
				wp_safe_redirect(home_url('/signin?social=linkedin&hint=no_account'));
			} else {
				error_log('EULEX LinkedIn user resolve/create error: ' . $user_id->get_error_message());
				wp_safe_redirect(home_url('/signin?social=linkedin_user_failed'));
			}
			exit;
		}

		$redirect_to = !empty($stored['redirect_to'])
			? wp_validate_redirect($stored['redirect_to'], home_url(EULEX_LINKEDIN_DEFAULT_REDIRECT))
			: home_url(EULEX_LINKEDIN_DEFAULT_REDIRECT);

		eulex_social_login_user((int) $user_id, $redirect_to);
	}
}, 0);
