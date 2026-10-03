import { createRouter } from "sv-router";

import Accounts from "../pages/Accounts.svelte";
import Dashboard from "../pages/Dashboard.svelte";
import RawTransactionDetail from "../pages/RawTransactionDetail.svelte";
import RawTransactions from "../pages/RawTransactions.svelte";
import Rules from "../pages/Rules.svelte";
import TransactionDetail from "../pages/TransactionDetail.svelte";
import Transactions from "../pages/Transactions.svelte";

// oxlint-disable-next-line typescript/unbound-method -- sv-router is meant to be destructured
export const { p, navigate, isActive, route } = createRouter({
	"/": Dashboard,
	"/raw": RawTransactions,
	"/raw/:accountId/:bankId": RawTransactionDetail,
	"/transactions": Transactions,
	"/transactions/:id": TransactionDetail,
	"/rules": Rules,
	"/accounts": Accounts,
});
