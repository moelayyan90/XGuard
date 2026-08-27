<?php

declare(strict_types=1);

namespace X402Pay\Facilitator {
	interface RequestSigner {
		public function sign( string $method, string $url ): array;
	}
	interface Facilitator {}
}

namespace X402Pay\Services {
	use X402Pay\Facilitator\RequestSigner;

	final class FacilitatorProfile {
		public function __construct(
			public readonly string $network,
			public readonly string $asset,
			public readonly int $asset_decimals,
			public readonly string $facilitator_url,
			public readonly string $eip712_name,
			public readonly string $eip712_version,
			public readonly string $environment_label,
			public readonly ?RequestSigner $signer = null,
		) {}
	}

	final class X402FacilitatorClient implements \X402Pay\Facilitator\Facilitator {
		public function __construct( public readonly FacilitatorProfile $profile ) {}
	}
}

namespace {
	define( 'ABSPATH', __DIR__ );

	$actions = array();
	$filters = array();

	function add_action( string $hook, callable $callback, int $priority = 10, int $accepted_args = 1 ): void {
		global $actions;
		$actions[ $hook ][] = array( $callback, $priority, $accepted_args );
	}

	function add_filter( string $hook, callable $callback, int $priority = 10, int $accepted_args = 1 ): void {
		global $filters;
		$filters[ $hook ][] = array( $callback, $priority, $accepted_args );
	}

	function apply_filters( string $hook, mixed $value, mixed ...$args ): mixed {
		global $filters;
		foreach ( $filters[ $hook ] ?? array() as $entry ) {
			$value = $entry[0]( $value, ...$args );
		}
		return $value;
	}

	final class WP_Connector_Registry {
		public array $registered = array();
		public function register( string $id, array $payload ): void {
			$this->registered[ $id ] = $payload;
		}
	}

	function expect( bool $condition, string $message ): void {
		if ( ! $condition ) {
			fwrite( STDERR, "FAIL: {$message}\n" );
			exit( 1 );
		}
	}

	require __DIR__ . '/xguard-x402-connector.php';

	global $actions, $filters;
	expect( isset( $actions['plugins_loaded'][0] ), 'plugins_loaded hook missing' );
	$actions['plugins_loaded'][0][0]();

	expect( isset( $actions['wp_connectors_init'][0] ), 'wp_connectors_init hook missing' );
	$registry = new WP_Connector_Registry();
	$actions['wp_connectors_init'][0][0]( $registry );

	$payload = $registry->registered['xguard_mainnet'] ?? null;
	expect( is_array( $payload ), 'xguard_mainnet registration missing' );
	expect( 'x402_facilitator' === $payload['type'], 'wrong connector type' );
	expect( 'none' === $payload['authentication']['method'], 'connector must be zero-config by default' );

	$provider = $filters['x402_pay_facilitator_for_connector'][0][0] ?? null;
	expect( is_callable( $provider ), 'facilitator provider filter missing' );

	putenv( 'XGUARD_LICENSE_KEY' );
	$client = $provider( null, 'xguard_mainnet' );
	expect( $client instanceof \X402Pay\Services\X402FacilitatorClient, 'wrong facilitator client type' );
	$profile = $client->profile;
	expect( 'base' === $profile->network, 'wrong network' );
	expect( '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' === $profile->asset, 'wrong Base USDC asset' );
	expect( 6 === $profile->asset_decimals, 'wrong USDC decimals' );
	expect( 'https://api.xguardgate.com' === $profile->facilitator_url, 'wrong XGuard facilitator URL' );
	expect( 'USD Coin' === $profile->eip712_name && '2' === $profile->eip712_version, 'wrong EIP-712 domain' );
	expect( null === $profile->signer, 'free mode should not emit authorization' );

	putenv( 'XGUARD_LICENSE_KEY=test-license' );
	$licensed = $provider( null, 'xguard_mainnet' );
	expect( null !== $licensed->profile->signer, 'licensed mode signer missing' );
	$headers = $licensed->profile->signer->sign( 'POST', 'https://api.xguardgate.com/settle' );
	expect( 'Bearer test-license' === ( $headers['Authorization'] ?? '' ), 'wrong Bearer authorization' );

	$sentinel = new \X402Pay\Services\X402FacilitatorClient( $profile );
	expect( $sentinel === $provider( $sentinel, 'xguard_mainnet' ), 'existing facilitator must not be overwritten' );
	expect( null === $provider( null, 'some_other_connector' ), 'foreign connector ID must pass through' );

	echo "XGuard WordPress x402 connector contract OK\n";
}
