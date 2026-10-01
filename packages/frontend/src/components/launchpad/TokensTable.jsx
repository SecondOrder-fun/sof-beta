// src/components/launchpad/TokensTable.jsx
// The discovery feed's list view — the existing Table primitive.

import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import TokenArt from "@/components/launchpad/TokenArt";
import { formatAge, formatFdvEth, formatMultiple, formatPercent } from "@/lib/launchFormat";

const TokensTable = ({ launches, markets }) => {
  const { t } = useTranslation("launchpad");

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("table.token")}</TableHead>
          <TableHead className="text-right">{t("table.fdv")}</TableHead>
          <TableHead className="text-right">{t("table.multiple")}</TableHead>
          <TableHead className="text-right">{t("table.sold")}</TableHead>
          <TableHead className="text-right">{t("table.age")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {launches.map((launch) => {
          const market = markets[launch.token.toLowerCase()];
          return (
            <TableRow key={launch.token}>
              <TableCell>
                <Link to={`/tokens/${launch.token}`} className="flex items-center gap-3">
                  <TokenArt
                    token={launch.token}
                    symbol={launch.symbol}
                    name={launch.name}
                    className="h-9 w-9 rounded-md"
                    textClassName="text-lg"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-heading truncate">{launch.name}</span>
                    <span className="block text-xs font-mono text-muted-foreground">${launch.symbol}</span>
                  </span>
                </Link>
              </TableCell>
              <TableCell className="text-right">{market ? `${formatFdvEth(market.fdvWei, 2)} ETH` : "—"}</TableCell>
              <TableCell className="text-right text-fabric-red">
                {market ? `${formatMultiple(market.multiple)}×` : "—"}
              </TableCell>
              <TableCell className="text-right">{market ? `${formatPercent(market.soldFraction)}%` : "—"}</TableCell>
              <TableCell className="text-right text-muted-foreground">{formatAge(launch.launchedAt)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

TokensTable.propTypes = {
  launches: PropTypes.arrayOf(PropTypes.shape({ token: PropTypes.string.isRequired })).isRequired,
  markets: PropTypes.object.isRequired,
};

export default TokensTable;
