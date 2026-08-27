<?php
/**
 * Plugin Name: XGuard Connector for x402 Pay
 * Plugin URI: https://xguardgate.com
 * Description: Adds XGuard's Base-mainnet x402 compatibility facilitator as an option in Automattic x402 Pay.
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
const XGUARD_X402_FACILITATOR_URL = 'https://xguardgate.com/api';
const XGUARD_X402_BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

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
						'description'    => 'XGuard x402 v2 compatibility route with replay protection, automatic routing and fail-closed ambiguous settlement handling.',
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
					'docsLinkText'  => 'XGuard API and integration docs',
					'docsUrl'       => 'https://xguardgate.com/api/docs',
				);
			},
			10,
			2
		);
	}
);
