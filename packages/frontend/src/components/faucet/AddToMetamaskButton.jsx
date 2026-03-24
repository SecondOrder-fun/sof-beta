// src/components/faucet/AddToMetamaskButton.jsx
import AddTokenToMetamaskButton from '@/components/common/AddTokenToMetamaskButton';

/**
 * AddToMetamaskButton component
 * Faucet-specific wrapper that adds the SOF token to MetaMask
 */
const AddToMetamaskButton = () => {
  const getSofTokenAddress = () => {
    const testnetAddress = import.meta.env.VITE_SOF_ADDRESS_TESTNET;
    const localAddress = import.meta.env.VITE_SOF_ADDRESS_LOCAL;
    return (testnetAddress || localAddress || '0x19ef058360ff2d8df87d4cf68511ce1993e88825').trim();
  };

  const sofAddress = getSofTokenAddress();

  return (
    <AddTokenToMetamaskButton
      address={sofAddress}
      symbol="SOF"
      decimals={18}
      image="https://raw.githubusercontent.com/SecondOrder-fun/branding/main/logo.png"
      label="Add SOF to MetaMask"
      fullWidth
    />
  );
};

export default AddToMetamaskButton;
