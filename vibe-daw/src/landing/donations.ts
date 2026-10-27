/** The project's own public receiving addresses, also listed in the README. */
const PROJECT_BTC_ADDRESS = 'bc1qgsc2jtrqs2l6ssujsvdzeuhz90tlhgdkvx2pw6';
const PROJECT_XMR_ADDRESS = '86Cd2nebXGacoZboCPD9LUdC3BQvJZS4ADoHC4g32Yj82jrJYGqBQ6cFSWj3fnLESV13Tf8FEG5fwBc67jfdoQ1MTrGpu2u';

/** A non-blank env value replaces the default, so forks can point donations at their own address. */
const address = (value: string | undefined, fallback = '') => String(value ?? '').trim() || fallback;

/** Public receiving addresses only. Empty entries are omitted from the page. */
export const donationWallets = [
  { name: 'Bitcoin', symbol: 'BTC', network: 'Bitcoin', address: address(import.meta.env.VITE_DONATION_BTC_ADDRESS, PROJECT_BTC_ADDRESS), scheme: 'bitcoin:' },
  { name: 'Monero', symbol: 'XMR', network: 'Monero', address: address(import.meta.env.VITE_DONATION_XMR_ADDRESS, PROJECT_XMR_ADDRESS), scheme: 'monero:' },
  { name: 'Ethereum', symbol: 'ETH', network: 'Ethereum mainnet', address: address(import.meta.env.VITE_DONATION_ETH_ADDRESS), scheme: 'ethereum:', suffix: '@1' },
  { name: 'Solana', symbol: 'SOL', network: 'Solana', address: address(import.meta.env.VITE_DONATION_SOL_ADDRESS), scheme: 'solana:' },
].filter((wallet) => wallet.address.length > 0);
