// src/components/admin/QuoteTokenPicker.jsx
//
// "Priced in" on the create-season forms (approved design): the token a
// season's tickets, prize pool and InfoFi markets use. Composed only from
// existing primitives — Select with SelectGroup / SelectLabel /
// SelectSeparator, TokenArt (Avatar) for token art, Input for a pasted
// address, and the outline Badge for a pasted token's standing.
//
//   closed    — the chosen token: art, name, $SYMBOL and a meta line
//               ("Launch token · 47.2 ETH FDV", or "Platform default")
//   open      — Your launches, then Approved by the platform, then Newest
//               launches; each item: art, name, $SYMBOL, FDV · age
//   paste     — any other token by address, checked the way the contract
//               checks it: a resolved row with its Badge when it may price a
//               season, the reason when it may not
//
// Presentational: the choice and its checks live in useQuoteTokenChoice, which
// the form owns, so the form can also read the chosen symbol, decimals and
// pool price and block submission.

import { Fragment, useId } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import TokenArt from "@/components/launchpad/TokenArt";
import { shortAddress } from "@/lib/format";
import { formatAge, formatFdvEth } from "@/lib/launchFormat";
import { QUOTE_TOKEN_BLOCK_MESSAGE } from "@/lib/quoteTokenMessages";

const TokenRow = ({ option, meta }) => {
  const { t } = useTranslation("raffle");
  return (
    <span className="flex min-w-0 items-center gap-3 text-left">
      <TokenArt
        token={option.address}
        symbol={option.symbol}
        name={option.name}
        className="h-8 w-8 shrink-0"
        textClassName="text-sm"
      />
      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-medium">{option.name || shortAddress(option.address)}</span>
          {option.symbol ? (
            <span className="font-mono text-xs text-muted-foreground">
              {t("quoteToken.symbol", { symbol: option.symbol })}
            </span>
          ) : null}
        </span>
        {meta ? <span className="block truncate text-xs text-muted-foreground">{meta}</span> : null}
      </span>
    </span>
  );
};

TokenRow.propTypes = {
  option: PropTypes.shape({
    address: PropTypes.string.isRequired,
    name: PropTypes.string,
    symbol: PropTypes.string,
  }).isRequired,
  meta: PropTypes.string,
};

/** The chosen token's meta line, on the closed trigger. */
const chosenMeta = (option, t) => {
  if (option.kind === "launch") {
    return option.fdvWei != null
      ? t("quoteToken.metaLaunch", { fdv: formatFdvEth(option.fdvWei, 1) })
      : t("quoteToken.metaLaunchNoFdv");
  }
  return option.isPlatformDefault ? t("quoteToken.metaPlatform") : t("quoteToken.metaApproved");
};

/** A list item's meta line: FDV · age for a launch. */
const itemMeta = (option, t) => {
  if (option.kind !== "launch") return chosenMeta(option, t);
  const age = formatAge(option.launchedAt);
  return option.fdvWei != null ? t("quoteToken.itemMeta", { fdv: formatFdvEth(option.fdvWei, 1), age }) : age;
};

const QuoteTokenPicker = ({ choice }) => {
  const { t } = useTranslation("raffle");
  const labelId = useId();
  const pasteId = useId();
  const pasteMessageId = useId();
  const { groups, selected, status, source, pasteText, setPasteText, selectFromList } = choice;

  const sections = [
    { key: "yours", label: t("quoteToken.groupYours"), options: groups.yours },
    { key: "approved", label: t("quoteToken.groupApproved"), options: groups.approved },
    { key: "newest", label: t("quoteToken.groupNewest"), options: groups.newest },
  ].filter((s) => s.options.length > 0);

  const pasteMessageKey = source === "paste" ? QUOTE_TOKEN_BLOCK_MESSAGE[status] : null;
  // Still checking is not an error; everything else that blocks is.
  const pasteInvalid = Boolean(pasteMessageKey) && status !== "checking";
  const resolved = source === "paste" && status === "eligible" ? selected : null;

  return (
    <div className="space-y-2">
      <label id={labelId} className="text-sm font-medium">
        {t("quoteToken.label")}
      </label>
      <Select value={selected?.address ?? ""} onValueChange={selectFromList}>
        <SelectTrigger aria-labelledby={labelId} className="h-auto min-h-10 py-2">
          <SelectValue placeholder={t("quoteToken.placeholder")}>
            {selected ? <TokenRow option={selected} meta={chosenMeta(selected, t)} /> : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {sections.map((section, i) => (
            <Fragment key={section.key}>
              {i > 0 ? <SelectSeparator /> : null}
              <SelectGroup>
                <SelectLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                  {section.label}
                </SelectLabel>
                {section.options.map((option) => (
                  <SelectItem key={option.address} value={option.address}>
                    <TokenRow option={option} meta={itemMeta(option, t)} />
                  </SelectItem>
                ))}
              </SelectGroup>
            </Fragment>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t("quoteToken.help")}</p>

      <div className="space-y-1 pt-1">
        <label htmlFor={pasteId} className="text-xs text-muted-foreground">
          {t("quoteToken.pasteLabel")}
        </label>
        <Input
          id={pasteId}
          placeholder={t("quoteToken.pastePlaceholder")}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          className={pasteInvalid ? "border-destructive font-mono" : "font-mono"}
          aria-invalid={pasteInvalid ? "true" : "false"}
          aria-describedby={pasteMessageKey ? pasteMessageId : undefined}
        />
        {pasteMessageKey ? (
          <p
            id={pasteMessageId}
            role={pasteInvalid ? "alert" : "status"}
            className={pasteInvalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
          >
            {t(pasteMessageKey)}
          </p>
        ) : null}
        {resolved ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <TokenRow option={resolved} />
            <Badge variant="outline" className="shrink-0">
              {resolved.kind === "launch" ? t("quoteToken.badgeLaunch") : t("quoteToken.badgeApproved")}
            </Badge>
          </div>
        ) : null}
      </div>
    </div>
  );
};

QuoteTokenPicker.propTypes = {
  /** The value of useQuoteTokenChoice(). */
  choice: PropTypes.shape({
    groups: PropTypes.shape({
      yours: PropTypes.array.isRequired,
      approved: PropTypes.array.isRequired,
      newest: PropTypes.array.isRequired,
    }).isRequired,
    selected: PropTypes.object,
    status: PropTypes.string.isRequired,
    source: PropTypes.string.isRequired,
    pasteText: PropTypes.string.isRequired,
    setPasteText: PropTypes.func.isRequired,
    selectFromList: PropTypes.func.isRequired,
  }).isRequired,
};

export default QuoteTokenPicker;
