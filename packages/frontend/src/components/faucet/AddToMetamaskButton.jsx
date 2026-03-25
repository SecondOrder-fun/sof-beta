// src/components/faucet/AddToMetamaskButton.jsx
import AddTokenToMetamaskButton from '@/components/common/AddTokenToMetamaskButton';
import { getContractAddresses } from '@/config/contracts';

/**
 * AddToMetamaskButton component
 * Faucet-specific wrapper that adds the SOF token to MetaMask
 */
const AddToMetamaskButton = () => {
  const contracts = getContractAddresses();
  const sofAddress = (contracts.SOF || '0x19ef058360ff2d8df87d4cf68511ce1993e88825').trim();

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
