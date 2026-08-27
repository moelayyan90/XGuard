<?php
/**
 * Plugin Name: XGuard Connector for x402 Pay
 * Plugin URI: https://xguardgate.com
 * Description: Adds XGuard High-Velocity x402 Facilitator as a Base mainnet facilitator option in Automattic x402 Pay.
 * Version: 1.0.0
 * Requires at least: 7.0
 * Requires PHP: 8.1
 * Requires Plugins: x402-pay
 * Author: XGuard contributors
 * Author URI: https://github.com/moelayyan90/XGuard
 * License: Apache-2.0
 * License URI: https://www.apache.org/licenses/LICENSE-2.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const XGUARD_X402_CONNECTOR_ID = 'xguard_mainnet';
const XGUARD_X402_FACILITATOR_URL = 'https://api.xguardgate.com';
const XGUARD_X402_BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * Resolve the optional XGuard Usage Credits license without storing a new
 * secret in this connector. Sites may define XGUARD_LICENSE_KEY in wp-config.php
 * or expose the same environment variable. Empty means free allowance mode.
 */
function xguard_x402_license_key(): string {
	$value = '';
	$env   = getenv( 'XGUARD_LICENSE_KEY' );
	if ( is_string( $env ) && '' !== trim( $env ) ) {
		$value = trim( $env );
	} elseif ( defined( 'XGUARD_LICENSE_KEY' ) ) {
		$constant = constant( 'XGUARD_LICENSE_KEY' );
		if ( is_string( $constant ) ) {
			$value = trim( $constant );
		}
	}

	/**
	 * Allows secret managers to inject a license without persisting it in this plugin.
	 *
	 * @param string $value Current resolved license key, possibly empty.
	 */
	return (string) apply_filters( 'xguard_x402_license_key', $value );
}

add_action(
	'plugins_loaded',
	static function (): void {
		if (
			! interface_exists( '\\X402Pay\\Facilitator\\RequestSigner' ) ||
			! interface_exists( '\\X402Pay\\Facilitator\\Facilitator' ) ||
			! class_exists( '\\X402Pay\\Services\\FacilitatorProfile' ) ||
			! class_exists( '\\X402Pay\\Services\\X402FacilitatorClient' )
		) {
			return;
		}

		if ( ! class_exists( 'XGuard_X402_Bearer_Signer', false ) ) {
			/**
			 * Adds XGuard Usage Credits authorization only when configured.
			 */
			class XGuard_X402_Bearer_Signer implements \X402Pay\Facilitator\RequestSigner {
				public function __construct( private readonly string $license_key ) {}

				public function sign( string $method, string $url ): array {
					unset( $method, $url );
					return array( 'Authorization' => 'Bearer ' . $this->license_key );
				}
			}
		}

		add_action(
			'wp_connectors_init',
			static function ( \WP_Connector_Registry $registry ): void {
				$registry->register(
					XGUARD_X402_CONNECTOR_ID,
					array(
						'name'           => 'XGuard — Base mainnet',
						'description'    => 'High-Velocity x402 routed facilitator with replay protection and ambiguity-safe settlement handling.',
						'type'           => 'x402_facilitator',
						'authentication' => array( 'method' => 'none' ),
						'plugin'         => array( 'file' => 'xguard-x402-connector/xguard-x402-connector.php' ),
					)
				);
			}
		);

		add_filter(
			'x402_pay_facilitator_for_connector',
			static function ( $existing, string $id ) {
				if ( XGUARD_X402_CONNECTOR_ID !== $id || null !== $existing ) {
					return $existing;
				}

				$license = xguard_x402_license_key();
				$signer  = '' === $license ? null : new XGuard_X402_Bearer_Signer( $license );

				$profile = new \X402Pay\Services\FacilitatorProfile(
					network: 'base',
					asset: XGUARD_X402_BASE_USDC,
					asset_decimals: 6,
					facilitator_url: XGUARD_X402_FACILITATOR_URL,
					eip712_name: 'USD Coin',
					eip712_version: '2',
					environment_label: 'Mainnet',
					signer: $signer,
				);

				return new \X402Pay\Services\X402FacilitatorClient( $profile );
			},
			10,
			2
		);

		add_filter(
			'x402_pay_connector_admin_meta',
			static function ( array $existing, string $id ): array {
				if ( XGUARD_X402_CONNECTOR_ID !== $id ) {
					return $existing;
				}
				return array(
					'introHeadline' => 'Route this WordPress x402 paywall through XGuard on Base mainnet.',
					'introBody'     => 'No XGuard key is required for the current free allowance. Sites with Usage Credits can define XGUARD_LICENSE_KEY in wp-config.php or the environment.',
					'docsLinkText'  => 'XGuard integration guide',
					'docsUrl'       => 'https://xguardgate.com/connect',
				);
			},
			10,
			2
		);
	}
);
