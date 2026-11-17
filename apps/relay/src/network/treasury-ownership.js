// Verified against the exact ERC-191 personal_sign message on 2026-11-17.
// Public proof does NOT authorize any transaction, transfer, token allowance,
// or future logins; never use this signature as an authentication token.
export const XGUARD_TREASURY_OWNERSHIP_PROOF = Object.freeze({
  address: '0x8e526ba9b0b348c1b6935176719d7acf0225aabf',
  network: 'eip155:8453',
  signed_date: '2026-11-17',
  expires: '2026-11-24',
  message: "XGuard wallet ownership verification only.\nDomain: xguardgate.com\nWallet: 0x8e526ba9b0b348c1b6935176719d7acf0225aabf\nNetwork: Base (eip155:8453)\nNonce: 015e7cf125fe0e29acd3e23f5b37981b\nIssued: 2026-11-17\nExpires: 2026-11-24\nPurpose: Prove control of this wallet address only. This message does not authorize transfers, token approvals, or payments.",
  signature: '0x937620c430f1bf75aef8e93b7cb55e2592c0dbfeb0792aafb9e29b47e468e1de6518ed52e33403c97744ec8b0604bb414b1513d184eef6c0bce53f28933bbbfd1c',
});
