// src/components/launchpad/CreatorFeesCard.jsx
//
// "Your creator fees" on a token's page, per the approved design. Renders only
// for the launch's current fee recipient — when that is the connected wallet —
// and nothing while loading, on a failed read, or for anyone else (a skeleton
// would flash on every visitor's page).
//
// States:
//   fees      — what the recipient has earned in the launch's quote token (ETH,
//               or the ERC-20 it is paired with — the trade fee is only ever
//               taken in it, on buys and sells alike): credited + their 88% of
//               the fees not yet collected; one primary claim button. Pending
//               fees get a line saying the claim collects them first (it does,
//               in the same batch).
//   empty     — "No fees yet" and a disabled "Nothing to claim"
//   claimed   — role=status "Claimed …" with a link to the transaction; shown
//               until the card unmounts, above the fees state if new fees arrive
//   handed on — after Transfer, a status saying where future fees go (the
//               recipient is no longer this account, so the rest of the card
//               would otherwise vanish mid-sentence)
// Every state but "handed on" ends with the fee recipient row and Transfer.
//
// Claims go through executeBatch from the connected wallet, which is the
// claimant (the placer pays credits to msg.sender).
//
// Composed from existing primitives: Card, the outline Badge, Button (primary
// and outline), Separator, and Dialog + Input in TransferFeesDialog.

import { useAccount } from "wagmi";
import { useId, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import TransferFeesDialog from "@/components/launchpad/TransferFeesDialog";
import { useCreatorFees, useCreatorFeeWrite } from "@/hooks/useCreatorFees";
import { getNetworkByKey } from "@/config/networks";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { shortAddress } from "@/lib/format";
import { formatQuoteAmount, formatTradeFee } from "@/lib/launchFormat";
import { ETH_QUOTE } from "@/config/launchQuoteTokens";
import {
  buildLaunchClaimCalls,
  buildTransferCalls,
  currencyKey,
  launchEarnings,
  sameAddress,
} from "@/lib/creatorFees";

/** The explorer page for a transaction, or null where the network has none (local). */
function txUrl(hash) {
  const explorer = getNetworkByKey(getStoredNetworkKey())?.explorer;
  return explorer && hash ? `${explorer.replace(/\/$/, "")}/tx/${hash}` : null;
}

const Amount = ({ label, value, unit, children }) => (
  <div className="rounded-lg border bg-muted/40 px-4 py-3 space-y-0.5">
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight text-heading">
        {value} <span className="text-sm font-medium text-muted-foreground">{unit}</span>
      </span>
    </div>
    {children ? <div className="text-right text-xs text-muted-foreground">{children}</div> : null}
  </div>
);

Amount.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  unit: PropTypes.string,
  children: PropTypes.node,
};

export const ClaimedStatus = ({ title, address, hash }) => {
  const { t } = useTranslation("launchpad");
  const url = txUrl(hash);
  return (
    <div role="status" className="space-y-1">
      <p className="flex items-center gap-2 font-semibold">
        <Check className="h-4 w-4 text-fabric-red" aria-hidden="true" />
        {title}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("creatorFees.claimedBody", { address: shortAddress(address) })}
      </p>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm">
          {t("creatorFees.viewTransaction")}
        </a>
      ) : null}
    </div>
  );
};

ClaimedStatus.propTypes = {
  title: PropTypes.string.isRequired,
  /** Where the claim was paid. */
  address: PropTypes.string.isRequired,
  hash: PropTypes.string,
};

const CreatorFeesCard = ({ token, name, market }) => {
  const { t } = useTranslation("launchpad");
  const { address } = useAccount();
  const { data } = useCreatorFees([{ token }], { account: address, enabled: Boolean(address) });
  const claim = useCreatorFeeWrite();
  const transfer = useCreatorFeeWrite();

  const [claimed, setClaimed] = useState(null);
  const [handedTo, setHandedTo] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const titleId = useId();

  if (handedTo) {
    return (
      <Card>
        <CardContent className="p-5">
          <p role="status" className="text-sm text-muted-foreground">
            {t("creatorFees.transferred", { name, address: shortAddress(handedTo) })}
          </p>
        </CardContent>
      </Card>
    );
  }

  const launch = data?.launches?.[0];
  const placerFees = launch ? data.placers[launch.placer.toLowerCase()] : null;
  if (!launch || !placerFees || !sameAddress(launch.recipient, address)) return null;

  const earned = launchEarnings(launch, placerFees, address);
  // The currency every one of this launch's fees is paid in.
  const quote = data.quotes?.[currencyKey(launch.quoteToken)] ?? market?.quote ?? ETH_QUOTE;
  const formatQuote = (raw) => formatQuoteAmount(raw, quote.decimals);
  const share = Number(placerFees.creatorFeeBps) / 100;
  // The launch's own trade fee, from its placement (useLaunchMarkets).
  const fee = market?.tradeFee != null ? formatTradeFee(market.tradeFee) : null;
  const hasFees = earned.quote > 0n;

  const onClaim = async () => {
    const { calls, quote: quoteAmount } = buildLaunchClaimCalls(launch, placerFees, address);
    try {
      const hash = await claim.send(calls);
      setClaimed({ quote: quoteAmount, hash, to: address });
    } catch {
      // Surfaced from claim.error below.
    }
  };

  const onTransfer = async (newRecipient) => {
    await transfer.send(buildTransferCalls(launch, newRecipient));
    setHandedTo(newRecipient);
  };

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {t("creatorFees.title")}
          </h2>
          <Badge variant="outline" className="text-muted-foreground">
            {fee != null ? t("creatorFees.shareBadge", { share, fee }) : t("creatorFees.shareBadgeNoRate", { share })}
          </Badge>
        </div>

        {claimed ? (
          <ClaimedStatus
            title={t("creatorFees.claimedQuote", { amount: formatQuote(claimed.quote), quote: quote.symbol })}
            address={claimed.to}
            hash={claimed.hash}
          />
        ) : null}

        {hasFees ? (
          <>
            <Amount label={t("creatorFees.earned")} value={formatQuote(earned.quote)} unit={quote.symbol}>
              {t("creatorFees.quotePooled", { quote: quote.symbol })}
            </Amount>

            {earned.quotePending > 0n ? (
              <p className="text-xs text-muted-foreground">
                {t("creatorFees.pendingQuote", { amount: formatQuote(earned.quotePending), quote: quote.symbol })}
              </p>
            ) : null}

            <div className="space-y-2">
              <Button type="button" size="lg" className="w-full" disabled={claim.isPending} onClick={onClaim}>
                {claim.isPending
                  ? t("creatorFees.claiming")
                  : t("creatorFees.claimQuote", { amount: formatQuote(earned.quote), quote: quote.symbol })}
              </Button>
              <p className="text-center text-xs text-muted-foreground">{t("creatorFees.captionSent")}</p>
            </div>
          </>
        ) : claimed ? null : (
          <>
            <p className="text-sm text-muted-foreground">
              {fee != null
                ? t("creatorFees.emptyBody", { share, fee, name, quote: quote.symbol })
                : t("creatorFees.emptyBodyNoRate", { share, name, quote: quote.symbol })}
            </p>
            <Button type="button" variant="outline" size="lg" className="w-full" disabled>
              {t("creatorFees.nothingToClaim")}
            </Button>
          </>
        )}

        {claim.error ? (
          <p className="text-xs text-destructive" role="alert">
            {t("creatorFees.failed")}: {claim.error.shortMessage || claim.error.message}
          </p>
        ) : null}

        <Separator className="bg-border" />

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{t("creatorFees.recipientLabel")}</div>
            <div className="text-sm">
              {t("creatorFees.you")}{" "}
              <span className="font-mono text-xs text-muted-foreground">{shortAddress(launch.recipient)}</span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            // Not while a transfer is in flight: reset() would detach it and
            // re-enable submit, letting a second setFeeRecipient go out.
            disabled={transfer.isPending}
            onClick={() => {
              transfer.reset();
              setDialogOpen(true);
            }}
          >
            {t("creatorFees.transfer")}
          </Button>
        </div>
      </CardContent>

      <TransferFeesDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        name={name}
        currentRecipient={launch.recipient}
        onTransfer={onTransfer}
        isPending={transfer.isPending}
        error={transfer.error}
      />
    </Card>
  );
};

CreatorFeesCard.propTypes = {
  token: PropTypes.string.isRequired,
  name: PropTypes.string,
  symbol: PropTypes.string,
  market: PropTypes.shape({ tradeFee: PropTypes.number, quote: PropTypes.object }),
};

export default CreatorFeesCard;
