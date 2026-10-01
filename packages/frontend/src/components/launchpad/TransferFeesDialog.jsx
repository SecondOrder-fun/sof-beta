// src/components/launchpad/TransferFeesDialog.jsx
//
// Hand a launch's future creator fees to another address (the placer's
// setFeeRecipient). Composed from Dialog, Label, Input and Button. The address
// is checked as the contract would check it (lib/creatorFees.validateNewRecipient)
// before Transfer is enabled, and the error shows once the field has been left
// or submitted, not while the address is still being typed.

import { useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { getAddress } from "viem";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { validateNewRecipient } from "@/lib/creatorFees";

const TransferFeesDialog = ({ open, onOpenChange, name, currentRecipient, onTransfer, isPending, error }) => {
  const { t } = useTranslation("launchpad");
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const problem = validateNewRecipient(value, currentRecipient);
  const showProblem = touched && value.trim() !== "" && problem;

  const close = (next) => {
    if (!next) {
      setValue("");
      setTouched(false);
    }
    onOpenChange(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (problem || isPending) return;
    try {
      await onTransfer(getAddress(value.trim()));
      close(false);
    } catch {
      // Shown from `error` below; the dialog stays open for a retry.
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("creatorFees.transferDialog.title", { name })}</DialogTitle>
            <DialogDescription>{t("creatorFees.transferDialog.body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="fee-recipient">{t("creatorFees.transferDialog.label")}</Label>
            <Input
              id="fee-recipient"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("creatorFees.transferDialog.placeholder")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={showProblem ? true : undefined}
              aria-describedby={showProblem ? "fee-recipient-error" : undefined}
              className="font-mono text-sm"
            />
            {showProblem ? (
              <p id="fee-recipient-error" className="text-xs text-destructive">
                {t(`creatorFees.transferDialog.errors.${problem}`)}
              </p>
            ) : null}
          </div>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {t("creatorFees.transferDialog.failed")}: {error.shortMessage || error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {t("creatorFees.transferDialog.cancel")}
            </Button>
            <Button type="submit" disabled={Boolean(problem) || isPending}>
              {isPending ? t("creatorFees.transferDialog.pending") : t("creatorFees.transferDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

TransferFeesDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  name: PropTypes.string,
  currentRecipient: PropTypes.string,
  onTransfer: PropTypes.func.isRequired,
  isPending: PropTypes.bool,
  error: PropTypes.object,
};

export default TransferFeesDialog;
