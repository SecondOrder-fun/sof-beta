// src/components/getsof/AddToMetamaskButton.jsx
import AddTokenToMetamaskButton from '@/components/common/AddTokenToMetamaskButton';
import { getContractAddresses } from '@/config/contracts';
import { useToast } from '@/hooks/useToast';

/**
 * AddToMetamaskButton — Get SOF page wrapper that registers the $SOF token
 * with the connected wallet for one-tap visibility.
 *
 * Routes the inner component's success/error feedback to the global toast
 * area (instead of the inline Alert that ships in the shared component) so
 * the Token Info panel doesn't grow vertically when the user clicks.
 */
const AddToMetamaskButton = () => {
  const contracts = getContractAddresses();
  const sofAddress = (contracts.SOF || '0x19ef058360ff2d8df87d4cf68511ce1993e88825').trim();
  const { toast } = useToast();

  const handleResult = ({ type, message }) => {
    toast({
      title: type === 'success' ? 'Token added' : 'Add token failed',
      description: message,
      variant: type === 'error' ? 'destructive' : 'default',
    });
  };

  return (
    <AddTokenToMetamaskButton
      address={sofAddress}
      symbol="SOF"
      decimals={18}
      image="https://raw.githubusercontent.com/SecondOrder-fun/branding/main/logo.png"
      label={
        <span className="flex flex-col items-start leading-tight">
          <span>Add SOF</span>
          <span>to MetaMask</span>
        </span>
      }
      variant="secondary"
      fullWidth
      // h-full stretches the button to the height of the data column on the
      // left, giving it the ~3x default-button height the layout calls for.
      className="h-full min-h-[5rem]"
      onResult={handleResult}
    />
  );
};

export default AddToMetamaskButton;
