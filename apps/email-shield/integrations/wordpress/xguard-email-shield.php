<?php
/**
 * Plugin Name: XGuard Email Shield
 * Description: Automatically checks registration and WooCommerce checkout emails with XGuard Email Shield.
 * Version: 3.0.0
 * Author: XGuard
 * License: Apache-2.0
 */

if (!defined('ABSPATH')) exit;

const XGUARD_EMAIL_SHIELD_OPTION = 'xguard_email_shield_api_key';
const XGUARD_EMAIL_SHIELD_API = 'https://api.xguardgate.com/v1/verify';

add_action('admin_menu', function () {
    add_options_page('XGuard Email Shield', 'XGuard Email Shield', 'manage_options', 'xguard-email-shield', 'xguard_email_shield_settings_page');
});

add_action('admin_init', function () {
    register_setting('xguard_email_shield', XGUARD_EMAIL_SHIELD_OPTION, [
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '',
    ]);
});

function xguard_email_shield_settings_page() {
    if (!current_user_can('manage_options')) return;
    ?>
    <div class="wrap">
      <h1>XGuard Email Shield</h1>
      <p>Paste your XGuard API key once. Registration and supported checkout emails are checked automatically.</p>
      <form method="post" action="options.php">
        <?php settings_fields('xguard_email_shield'); ?>
        <table class="form-table"><tr><th scope="row">API key</th><td>
          <input type="password" class="regular-text" autocomplete="off" name="<?php echo esc_attr(XGUARD_EMAIL_SHIELD_OPTION); ?>" value="<?php echo esc_attr(get_option(XGUARD_EMAIL_SHIELD_OPTION, '')); ?>" />
        </td></tr></table>
        <?php submit_button(); ?>
      </form>
      <p><a href="https://xguardgate.com" target="_blank" rel="noopener noreferrer">Get 100 free checks</a></p>
    </div>
    <?php
}

function xguard_email_shield_verify($email) {
    $key = trim((string) get_option(XGUARD_EMAIL_SHIELD_OPTION, ''));
    if ($key === '') return ['ok' => true, 'decision' => 'unconfigured'];

    $response = wp_remote_post(XGUARD_EMAIL_SHIELD_API, [
        'timeout' => 6,
        'redirection' => 0,
        'headers' => [
            'Authorization' => 'Bearer ' . $key,
            'Content-Type' => 'application/json',
        ],
        'body' => wp_json_encode(['email' => $email]),
        'data_format' => 'body',
    ]);

    if (is_wp_error($response)) return ['ok' => true, 'decision' => 'unavailable'];
    $code = (int) wp_remote_retrieve_response_code($response);
    $body = json_decode(wp_remote_retrieve_body($response), true);
    if ($code !== 200 || !is_array($body)) return ['ok' => true, 'decision' => 'unavailable'];
    return ['ok' => (($body['decision'] ?? '') !== 'reject'), 'decision' => (string) ($body['decision'] ?? 'unknown')];
}

add_filter('registration_errors', function ($errors, $sanitized_user_login, $user_email) {
    if (!is_email($user_email)) return $errors;
    $check = xguard_email_shield_verify($user_email);
    if (!$check['ok']) $errors->add('xguard_email_rejected', __('This email address cannot be accepted. Please use a valid non-temporary email address.', 'xguard-email-shield'));
    return $errors;
}, 10, 3);

add_action('woocommerce_after_checkout_validation', function ($data, $errors) {
    if (!is_array($data) || !isset($data['billing_email']) || !is_email($data['billing_email'])) return;
    $check = xguard_email_shield_verify($data['billing_email']);
    if (!$check['ok']) $errors->add('xguard_email_rejected', __('Please use a valid non-temporary email address.', 'xguard-email-shield'));
}, 10, 2);
