(function () {
	'use strict';

	const IDS = {
		launcher: 'tm-cat-launcher',
		overlay: 'tm-cat-overlay',
		modal: 'tm-cat-modal',
		groupList: 'tm-cat-groups',
		form: 'tm-cat-form',
		triage: 'tm-cat-triage',
		triageResults: 'tm-cat-triage-results',
		response: 'tm-cat-response',
		status: 'tm-cat-status',
		history: 'tm-cat-history',
		context: 'tm-cat-context',
	};
	const STORAGE_KEY = 'tm-merchantos-credit-account-toolbox';
	const HISTORY_KEY = 'tm-merchantos-credit-account-toolbox-history';
	const API_BASE_PATH = '/admin/invoicing';
	const state = { operationKey: '', activeView: 'operation', advanced: false, modalOpen: false, settings: null, history: [], customerContext: null, customerContextKey: '', customerContextLoading: false, customerContextError: '' };
	const generatedApiMetadata = [
			{
				"method": "POST",
				"path": "/account-statements/{proposalHash}/payments",
				"pathFields": [
					"proposalHash"
				],
				"queryFields": [],
				"bodyFields": [
					"amount",
					"currency",
					"paymentSessionRef",
					"paymentType"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/account-statements/{statementID}/send",
				"pathFields": [
					"statementID"
				],
				"queryFields": [],
				"bodyFields": [
					"emailMethod",
					"invoicesDueDateRange"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/credit-accounts/{creditAccountID}/account-statements",
				"pathFields": [
					"creditAccountID"
				],
				"queryFields": [],
				"bodyFields": [
					"customerDetails",
					"location",
					"lsCreditAccountId",
					"lsRegisterId"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/backoffice/BulkEnableInvoicingModule",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"externalMerchantIds",
					"platformKey"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/backoffice/BulkRunRepairTransactions",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"action",
					"deletePendingTransaction",
					"externalCreditAccountId",
					"externalMerchantId",
					"platformKey",
					"saleIds",
					"steps"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/backoffice/GetEveryAccountTransactionByFilter",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"cursor",
					"externalCreditAccountId",
					"externalMerchantId",
					"pageLen",
					"platformKey",
					"status"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title"
					]
				}
			},
			{
				"method": "POST",
				"path": "/backoffice/GetEveryCreditAccountByFilter",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"cursor",
					"externalMerchantId",
					"pageLen",
					"platformKey",
					"sortAsc",
					"sortKey"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title",
						"updatedAt"
					]
				}
			},
			{
				"method": "POST",
				"path": "/backoffice/GetEveryMerchantByFilter",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"externalMerchantId",
					"limit",
					"offset",
					"platformKey"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/backoffice/GetFirstAccountTransactionByID",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"externalCreditAccountId",
					"externalMerchantId",
					"platformKey",
					"transactionRef"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title"
					]
				}
			},
			{
				"method": "POST",
				"path": "/backoffice/GetFirstCreditAccountByID",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"creditAccountRef"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title",
						"updatedAt"
					]
				}
			},
			{
				"method": "POST",
				"path": "/backoffice/GetFirstMerchantByID",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"merchantId"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/backoffice/ReconciliationPreview",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"externalCreditAccountId",
					"externalMerchantId",
					"platformKey",
					"useCrossRef",
					"verbose"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "DELETE",
				"path": "/credit-accounts/{creditAccountID}",
				"pathFields": [
					"creditAccountID"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"creditAccountRef",
					"creditLimit",
					"currency",
					"customer"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title"
					]
				}
			},
			{
				"method": "GET",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [
					"includeOverdue",
					"credit_limit"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/balances/refresh",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [
					"recalculateDocuments"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/credit-limit",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [
					"creditLimit",
					"hasUnlimitedCreditLimit"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/credit-memos/auto-apply",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [
					"dryRun"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/customer",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [
					"addresses",
					"companyName",
					"customerRef",
					"emails",
					"firstName",
					"lastName",
					"phoneNumbers",
					"title"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/identify-drift",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/verify-balance",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [
					"expectedBalance",
					"note",
					"toleranceMinorUnits"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts/heal",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"creditAccountRef"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts/merge",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"destinationCreditAccountRef",
					"sourceCreditAccountRefs"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/credit-accounts/{creditAccountIdOrRef}/customer",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/credit-accounts/{creditAccountIdOrRef}/customer",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [
					"addresses",
					"companyName",
					"customerRef",
					"emails",
					"firstName",
					"lastName",
					"phoneNumbers",
					"title"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/credit-accounts/{creditAccountIdOrRef}/reminders",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/credit-accounts/{creditAccountIdOrRef}/settings",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/credit-accounts/{creditAccountIdOrRef}/settings",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [
					"autoARSettings",
					"enabled"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/payment-hash/{paymentHash}/invoice-payment-instruction",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef",
					"paymentHash"
				],
				"queryFields": [],
				"bodyFields": [
					"salePaymentRef"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/transactions/repair",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"action",
					"deletePendingTransaction",
					"externalAccountID",
					"externalCreditAccountID",
					"integrationKey",
					"saleID"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "DELETE",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [
					"status",
					"limit",
					"cursor"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{idOrTransactionRef}/invoice-intent",
				"pathFields": [
					"creditAccountIdOrRef",
					"idOrTransactionRef"
				],
				"queryFields": [],
				"bodyFields": [
					"amount",
					"currency",
					"identifier",
					"invoice"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title"
					]
				}
			},
			{
				"method": "DELETE",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/complete",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [
					"payments",
					"amount",
					"capturedAt",
					"chargeId",
					"currency",
					"isCreditAccountPayment",
					"paymentChargeReference",
					"paymentRef",
					"paymentTypeName",
					"paymentTypeRef",
					"remoteReference",
					"surchargeAmount",
					"tipAmount"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title"
					]
				}
			},
			{
				"method": "DELETE",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/deposit-instruction",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/deposit-instruction",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [
					"amount",
					"currency",
					"notes",
					"source"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "DELETE",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/deposit-usage-intent",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/deposit-usage-intent",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [
					"autoAllocate",
					"creditMemoAllocations",
					"currency",
					"totalAmount"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "DELETE",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/invoice-intent",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "DELETE",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/invoice-payment-instruction",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/invoice-payment-instruction",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [
					"autoAllocate",
					"currency",
					"existingPaymentHash",
					"invoiceAllocations",
					"tags",
					"totalAmount"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "DELETE",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/refund-intent",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/refund-intent",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [
					"createdAt",
					"currency",
					"depositUsageIntent",
					"invoiceCreate",
					"invoiceIntent",
					"totalAmount"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title"
					]
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/repair",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [
					"payments",
					"amount",
					"capturedAt",
					"chargeId",
					"currency",
					"isCreditAccountPayment",
					"paymentChargeReference",
					"paymentRef",
					"paymentTypeName",
					"paymentTypeRef",
					"remoteReference",
					"surchargeAmount",
					"tipAmount"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title"
					]
				}
			},
			{
				"method": "DELETE",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/return-instruction",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/return-instruction",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [
					"amount",
					"applicationInstructions",
					"currency"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/void",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [
					"invoiceAdjustment",
					"accountRef",
					"creditAccountRef",
					"currency",
					"customer",
					"deposits",
					"discountTotal",
					"employee",
					"feesTotal",
					"invoiceIntentId",
					"issueDate",
					"lineItems",
					"location",
					"payments",
					"pli",
					"registerRef",
					"saleTaxCalculations",
					"subtotal",
					"tags",
					"taxNumber",
					"taxTotal",
					"taxableTotal",
					"terms",
					"total",
					"transactionRef"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title"
					]
				}
			},
			{
				"method": "PUT",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/void-intent",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [
					"amount",
					"currency"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/{transactionRef}/voidable",
				"pathFields": [
					"creditAccountIdOrRef",
					"transactionRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/transactions/bulk-create-invoices",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [],
				"bodyFields": [
					"invoices",
					"amount",
					"completedAt",
					"currency",
					"invoice",
					"payments",
					"transactionRef"
				],
				"nestedBodyFields": {
					"customer": [
						"addresses",
						"companyName",
						"customerRef",
						"emails",
						"firstName",
						"lastName",
						"phoneNumbers",
						"title"
					]
				}
			},
			{
				"method": "GET",
				"path": "/v1/transactions",
				"pathFields": [],
				"queryFields": [
					"status",
					"limit",
					"cursor"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/express-provision-credit-account",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"externalAccountID",
					"externalCreditAccountID",
					"integrationKey"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/express-provision-credit-account-batch",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"externalAccountID",
					"externalCreditAccountIDs",
					"integrationKey"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/provision/merchant-account/v2",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"accountRef",
					"currency",
					"integrationKey",
					"language",
					"shopName"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/provisioning/reminders/bulk-send",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"externalAccountIds",
					"integrationKey"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/feature-flags/account/bool/{flagName}",
				"pathFields": [
					"flagName"
				],
				"queryFields": [
					"default"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/feature-flags/account/int/{flagName}",
				"pathFields": [
					"flagName"
				],
				"queryFields": [
					"default"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/feature-flags/account/string/{flagName}",
				"pathFields": [
					"flagName"
				],
				"queryFields": [
					"default"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/feature-flags/global/bool/{flagName}",
				"pathFields": [
					"flagName"
				],
				"queryFields": [
					"default"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/feature-flags/global/int/{flagName}",
				"pathFields": [
					"flagName"
				],
				"queryFields": [
					"default"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/feature-flags/global/string/{flagName}",
				"pathFields": [
					"flagName"
				],
				"queryFields": [
					"default"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/invoices/{invoiceIdOrProposalHash}/payments",
				"pathFields": [
					"invoiceIdOrProposalHash"
				],
				"queryFields": [],
				"bodyFields": [
					"amount",
					"currency",
					"note",
					"paymentSessionRef",
					"paymentType"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/ls-invoices",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"currency",
					"customer",
					"depositPayments",
					"discountTotal",
					"employee",
					"isReturn",
					"itemFees",
					"lineItems",
					"location",
					"lsAccountId",
					"lsCreditAccountId",
					"lsRegisterId",
					"lsSaleId",
					"note",
					"payments",
					"returnOfInvoiceID",
					"saleCompletedAt",
					"saleTaxCalculations",
					"setDueDate",
					"source",
					"subtotal",
					"taxTotal",
					"total",
					"totalFeesAmount",
					"workOrders"
				],
				"nestedBodyFields": {
					"customer": [
						"address",
						"email",
						"firstName",
						"lastName",
						"lsCustomerCreditAccountId",
						"lsCustomerId",
						"source"
					]
				}
			},
			{
				"method": "DELETE",
				"path": "/ls-invoices/{externalID}",
				"pathFields": [
					"externalID"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PATCH",
				"path": "/ls-invoices/{externalID}",
				"pathFields": [
					"externalID"
				],
				"queryFields": [],
				"bodyFields": [
					"dueDate",
					"email",
					"note",
					"sendEmail"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/ls-invoices/reference/{externalID}",
				"pathFields": [
					"externalID"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/make-payment",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"depositAmountToAdd",
					"depositPayments",
					"extradata",
					"integrationKey",
					"invoicesToPay",
					"payments",
					"saleData"
				],
				"nestedBodyFields": {
					"customer": [
						"address",
						"email",
						"firstName",
						"lastName",
						"lsCustomerCreditAccountId",
						"lsCustomerId",
						"source"
					]
				}
			},
			{
				"method": "POST",
				"path": "/pay-balance",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"allocations",
					"creditAccountId",
					"currency",
					"paymentSessionRef",
					"paymentType",
					"pliMetadata"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/pay-balance/process-saved-method",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"allocations",
					"creditAccountId",
					"currency",
					"employeeId",
					"paymentMethodId",
					"paymentType",
					"pliMetadata",
					"registerId"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/payable-invoices",
				"pathFields": [],
				"queryFields": [
					"customerId",
					"creditAccountId",
					"currency"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/payment-requests",
				"pathFields": [],
				"queryFields": [
					"query"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/payment-requests",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"accountRef",
					"currency",
					"customer",
					"documentRefs",
					"employeeRef",
					"integrationKey",
					"location",
					"metadata",
					"note",
					"paymentAction",
					"pli",
					"pricingTables",
					"registerRef",
					"requestedAmount",
					"sendMethod",
					"sendToEmail",
					"shopRef"
				],
				"nestedBodyFields": {
					"customer": [
						"creditAccountRef",
						"customerRef",
						"email",
						"firstName",
						"lastName"
					]
				}
			},
			{
				"method": "GET",
				"path": "/payment-requests/{paymentRequestID}",
				"pathFields": [
					"paymentRequestID"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/payment-requests/{paymentRequestID}/cancel",
				"pathFields": [
					"paymentRequestID"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/payment-requests/{paymentRequestID}/refresh",
				"pathFields": [
					"paymentRequestID"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/payment-requests/{paymentRequestID}/send",
				"pathFields": [
					"paymentRequestID"
				],
				"queryFields": [],
				"bodyFields": [
					"sendToEmail"
				],
				"nestedBodyFields": {
					"customer": [
						"creditAccountRef",
						"customerRef",
						"email",
						"firstName",
						"lastName"
					]
				}
			},
			{
				"method": "POST",
				"path": "/payment-requests/cancel",
				"pathFields": [],
				"queryFields": [
					"documentRef",
					"status",
					"customerRef"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/payment-requests/search",
				"pathFields": [],
				"queryFields": [
					"id",
					"status",
					"customerRef",
					"accountRef",
					"sort",
					"limit",
					"page"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/proposals/{proposalHash}/payment-requests/deposit",
				"pathFields": [
					"proposalHash"
				],
				"queryFields": [],
				"bodyFields": [
					"accountStatementContext",
					"accountStatementId",
					"application_identifier",
					"application_label",
					"application_preferred_name",
					"authorizationCode",
					"bankAccount",
					"billingDetails",
					"bulkInvoicePaymentTransactionId",
					"capturedAt",
					"contactId",
					"creditCard",
					"creditMemoId",
					"currency",
					"customerAccountID",
					"debtInvoiceReferenceID",
					"externalCheckout",
					"externalId",
					"fingerprintId",
					"hash",
					"integrationKey",
					"isDraft",
					"locationId",
					"lsSaleContext",
					"newOrder",
					"note",
					"organizationId",
					"originalPaymentID",
					"paymentSessionRef",
					"paymentTransactionsExternalIds",
					"paymentType",
					"paymentTypeId",
					"paymentTypeName",
					"priceListBulkPayment",
					"saveCard",
					"skipCustomFieldsAndAttributesValidation",
					"source",
					"terminalId",
					"transactions"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/proposal-preview",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"accountID",
					"accountRef",
					"objectData",
					"objectType"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/reminders/{reminderID}/send",
				"pathFields": [
					"reminderID"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/scheduledpayments/{paymentMethodRef}/process",
				"pathFields": [
					"paymentMethodRef"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/settings",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/settings",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"autoARSettings",
					"enabledByDefault",
					"paused"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/staff/credit-accounts/identify-drift",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"accountId",
					"accountRef",
					"creditAccountRef",
					"imbalancedCreditAccountEntryId",
					"integrationKey"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/staff/detect-imbalanced-credit-accounts",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"accountRefs",
					"integrationKey"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/staff/solve-imbalanced-credit-account-entries",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"accountRefs",
					"integrationKey"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/balance-drift-records",
				"pathFields": [],
				"queryFields": [
					"pageSize",
					"activePage",
					"sortAsc",
					"sortField",
					"creditAccountId",
					"accountRef",
					"integrationKey",
					"status",
					"amountFilter",
					"reason",
					"investigationNotes",
					"startDate",
					"endDate"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "DELETE",
				"path": "/v1/balance-drift-records/{id}",
				"pathFields": [
					"id"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PATCH",
				"path": "/v1/balance-drift-records/{id}",
				"pathFields": [
					"id"
				],
				"queryFields": [],
				"bodyFields": [
					"investigationNotes",
					"status"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/drifts",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"creditAccountRef",
					"integrationKey",
					"investigationNotes",
					"reason",
					"saleRef"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/staff/imbalanced-credit-account-entries",
				"pathFields": [],
				"queryFields": [
					"integrationKey",
					"accountRef",
					"creditAccountId",
					"creditAccountRef",
					"solved",
					"pageSize",
					"activePage",
					"sortAsc",
					"sortField"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/contact-aggregate-data",
				"pathFields": [],
				"queryFields": [
					"statuses",
					"textSearch"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/contact-balances",
				"pathFields": [],
				"queryFields": [
					"statuses",
					"textSearch",
					"sort",
					"page",
					"limit"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/credit-memos",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [
					"page",
					"limit"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/credit-accounts/{creditAccountIdOrRef}/invoices",
				"pathFields": [
					"creditAccountIdOrRef"
				],
				"queryFields": [
					"transactionRef",
					"tags",
					"sort",
					"textSearch",
					"page",
					"limit"
				],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/emails/send",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"payload",
					"recipientEmails",
					"template"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/merchant/provisioning-summary",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/notifications/lists",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/notifications/lists/{listId}/subscribers",
				"pathFields": [
					"listId"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/v1/notifications/lists/{listId}/subscribers",
				"pathFields": [
					"listId"
				],
				"queryFields": [],
				"bodyFields": [
					"subscribers",
					"notificationRecipientRef"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/notifications/recipients",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/notifications/recipients",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"emailAddress",
					"firstName",
					"isArchived",
					"lastName",
					"notificationRecipientRef",
					"phoneNumber"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/payment-method-settings/default",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "PUT",
				"path": "/v1/payment-method-settings/default",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"invoiceConfiguration",
					"paymentRequestConfiguration",
					"statementConfiguration"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/payment-terms",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"numberOfDays",
					"schedule",
					"type"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/payment-terms/default",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/payment-sessions",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"documentId",
					"documentType",
					"proposalHash",
					"redirectUrl"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/payments/sessions/pay-balance",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"accountId",
					"creditAccountId",
					"currency",
					"employeeId",
					"invoiceId",
					"paymentTotal",
					"pliMetadata",
					"redirectUrl",
					"registerId"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/payments/{paymentID}/status",
				"pathFields": [
					"paymentID"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/payments/{paymentIDOrHash}/allocations",
				"pathFields": [
					"paymentIDOrHash"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "GET",
				"path": "/v1/payments/by-external-sale/{integrationKey}/{saleID}",
				"pathFields": [
					"integrationKey",
					"saleID"
				],
				"queryFields": [],
				"bodyFields": [],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/scheduled-payments/{invoiceId}/cancel",
				"pathFields": [
					"invoiceId"
				],
				"queryFields": [],
				"bodyFields": [
					"cancelledByUser",
					"firstName",
					"lastName",
					"userRef"
				],
				"nestedBodyFields": {
					"customer": []
				}
			},
			{
				"method": "POST",
				"path": "/v1/ui-telemetry",
				"pathFields": [],
				"queryFields": [],
				"bodyFields": [
					"logs",
					"metrics"
				],
				"nestedBodyFields": {
					"customer": []
				}
			}
		];
	const operations = generatedApiMetadata.map((operation) => makeOperation(operation.method, operation.path, operation.group));

	function makeOperation(method, path, group) {
		const key = `${method}-${path}`;
		const metadata = generatedApiMetadata.find((operation) => operation.method === method && operation.path === path) || {};
		const pathFields = metadata.pathFields || [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
		const dangerous = method === 'DELETE' || /\/(void|merge|heal|repair|cancel|delete)/i.test(path) || /^(\/staff|\/backoffice)/i.test(path);
		const resolvedGroup = dangerous ? 'Staff / dangerous' : method === 'GET' ? 'Read' : 'Routine';
		return { ...metadata, key, method, path, group: resolvedGroup, dangerous, pathFields };
	}

	function loadSettings() {
		try { return { advanced: false, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { return { advanced: false }; }
	}
	function saveSettings(patch) { state.settings = { ...state.settings, ...patch }; localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings)); }
	function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
	function saveHistory(entry) { state.history = [entry, ...state.history].slice(0, 50); localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history)); }
	function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
	function el(tag, props = {}, children = []) { const node = document.createElement(tag); Object.entries(props).forEach(([key, value]) => { if (key === 'className') node.className = value; else if (key === 'textContent') node.textContent = value; else if (key === 'checked' && node instanceof HTMLInputElement) node.checked = Boolean(value); else if (key.startsWith('on')) node.addEventListener(key.slice(2), value); else node.setAttribute(key, String(value)); }); children.forEach((child) => node.append(child)); return node; }
	function isCustomerLocation() { const url = new URL(location.href); return url.hostname === 'us.merchantos.com' && (url.searchParams.get('tab') === 'customers' || (url.searchParams.get('name') === 'customer.views.customer' && url.searchParams.has('id'))); }
	function currentCustomerId() { const url = new URL(location.href); return url.searchParams.get('id') || ''; }
	function currentAccountId() { return window.merchantos?.account?.id || ''; }
	function buildCustomerApiUrl(customerId) { const accountId = currentAccountId(); if (!accountId || !customerId) return null; return new URL(`/API/V3/Account/${encodeURIComponent(accountId)}/Customer/${encodeURIComponent(customerId)}.json?load_relations=all`, location.origin); }
	function normalizeCustomerContext(payload, customerId) {
		const customer = payload?.Customer || {};
		const creditAccountId = customer?.CreditAccount?.creditAccountID || customer?.creditAccountID || '';
		return {
			customerId: String(customer.customerID || customerId || ''),
			customerRef: customer.customerID || customerId ? `ls-retail_${customer.customerID || customerId}` : '',
			creditAccountId: String(creditAccountId || ''),
			creditAccountRef: creditAccountId ? `ls-retail_${creditAccountId}` : '',
			name: [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim(),
		};
	}
	async function loadCustomerContext() {
		const customerId = currentCustomerId();
		const url = buildCustomerApiUrl(customerId);
		if (!url || state.customerContextLoading || state.customerContextKey === `${currentAccountId()}:${customerId}`) return state.customerContext;
		state.customerContext = null;
		state.customerContextLoading = true;
		state.customerContextError = '';
		try {
			const response = await fetch(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json, text/plain, */*' } });
			if (!response.ok) throw new Error(`Customer lookup failed with HTTP ${response.status}`);
			const payload = await response.json();
			state.customerContext = normalizeCustomerContext(payload, customerId);
			state.customerContextKey = `${currentAccountId()}:${customerId}`;
			if (state.modalOpen) { renderCustomerContextLabel(); renderForm(); }
			return state.customerContext;
		} catch (error) {
			state.customerContext = null;
			state.customerContextKey = '';
			state.customerContextError = String(error?.message || error);
			renderCustomerContextLabel();
			return null;
		} finally {
			state.customerContextLoading = false;
		}
	}
	function prefillForField(field) {
		const context = state.customerContext;
		if (!context) return '';
		if (field === 'customerRef' || field === 'externalCustomerId') return context.customerRef;
		if (field === 'creditAccountRef' || field === 'accountRef' || field === 'externalCreditAccountId' || field === 'creditAccountIdOrRef') return context.creditAccountRef;
		if (field === 'customerId') return context.customerId;
		if (field === 'creditAccountId') return context.creditAccountId;
		if (field === 'creditAccountID') return context.creditAccountId;
		if (field === 'lsCreditAccountId') return context.creditAccountId;
		if (field === 'customer.lsCustomerId') return context.customerId;
		if (field === 'customer.lsCustomerCreditAccountId') return context.creditAccountId;
		return '';
	}
	function customerContextLabel() {
		if (state.customerContext) return `Customer ${state.customerContext.customerRef} | Credit account ${state.customerContext.creditAccountRef || 'not found'}`;
		if (!currentCustomerId()) return 'No customer ID in the current URL.';
		if (state.customerContextLoading) return 'Loading customer context...';
		return `Customer ID ${currentCustomerId()}${state.customerContextError ? ` | ${state.customerContextError}` : ''}`;
	}
	function renderCustomerContextLabel() {
		const label = document.getElementById(IDS.context);
		if (label) label.textContent = customerContextLabel();
	}
	function currentOperation() { return operations.find((operation) => operation.key === state.operationKey) || operations[0]; }
	function queryFieldsForOperation(operation) { return (operation.queryFields || []).map((key) => ({ key, label: humanizeFieldName(key), type: /limit|page|size|offset/i.test(key) ? 'number' : 'text' })); }
	function humanizeFieldName(field) { return field.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase()); }
	function bodyFieldType(field) { return /amount|total|limit|days|balance|count|offset|page|minorunits/i.test(field) ? 'number' : 'text'; }
	function bodyFieldsForOperation(operation) {
		const fields = (operation.bodyFields || []).map((key) => ({ key, label: humanizeFieldName(key), type: bodyFieldType(key) }));
		Object.entries(operation.nestedBodyFields || {}).forEach(([parent, children]) => {
			if (!operation.bodyFields?.includes(parent)) return;
			children.forEach((child) => fields.push({ key: `${parent}.${child}`, label: `${humanizeFieldName(parent)} / ${humanizeFieldName(child)}`, type: bodyFieldType(child) }));
		});
		return fields.filter((field) => !Object.prototype.hasOwnProperty.call(operation.nestedBodyFields || {}, field.key));
	}
	function groupedOperations() { return operations.reduce((groups, operation) => { (groups[operation.group] ||= []).push(operation); return groups; }, {}); }
	const triageFields = [
		{ key: 'integrationKey', label: 'Integration key', value: 'ls-retail' },
		{ key: 'accountRef', label: 'Merchant account ref', value: () => currentAccountId() ? `ls-retail_${currentAccountId()}` : '' },
		{ key: 'creditAccountRef', label: 'Credit account ref', value: () => state.customerContext?.creditAccountRef || '' },
		{ key: 'creditAccountId', label: 'Credit account ID' },
		{ key: 'solved', label: 'Solved filter' },
		{ key: 'status', label: 'Drift status' },
		{ key: 'reason', label: 'Drift reason' },
		{ key: 'amountFilter', label: 'Amount filter' },
		{ key: 'investigationNotes', label: 'Investigation notes' },
		{ key: 'startDate', label: 'Start date', type: 'date' },
		{ key: 'endDate', label: 'End date', type: 'date' },
		{ key: 'pageSize', label: 'Page size', type: 'number', value: '50' },
		{ key: 'activePage', label: 'Page', type: 'number', value: '1' },
		{ key: 'sortAsc', label: 'Ascending sort' },
		{ key: 'sortField', label: 'Sort field' },
	];
	const triageEntryFields = ['integrationKey', 'accountRef', 'creditAccountId', 'creditAccountRef', 'solved', 'pageSize', 'activePage', 'sortAsc', 'sortField'];
	const triageDriftFields = ['pageSize', 'activePage', 'sortAsc', 'sortField', 'creditAccountId', 'accountRef', 'integrationKey', 'status', 'amountFilter', 'reason', 'investigationNotes', 'startDate', 'endDate'];

	function triageValue(field) {
		const value = typeof field.value === 'function' ? field.value() : field.value;
		return value || '';
	}
	function triageValues() {
		const root = document.getElementById(IDS.triage);
		const values = {};
		root?.querySelectorAll('input').forEach((input) => { values[input.name] = input.value.trim(); });
		return values;
	}
	function buildTriageUrl(path, values, fields) {
		const url = new URL(`${API_BASE_PATH}${path}`, location.origin);
		fields.forEach((field) => { if (values[field]) url.searchParams.set(field, values[field]); });
		return url;
	}
	async function fetchTriageResponse(url, method = 'GET', body) {
		const init = { method, credentials: 'include', headers: { Accept: 'application/json, text/plain, */*' } };
		if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
		const response = await fetch(url, init);
		const contentType = response.headers.get('content-type') || '';
		const result = contentType.includes('json') ? await response.json() : await response.text();
		if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
		return { response, result };
	}
	function triageRows(payload) {
		if (Array.isArray(payload)) return payload;
		if (Array.isArray(payload?.data)) return payload.data;
		if (Array.isArray(payload?.items)) return payload.items;
		if (Array.isArray(payload?.records)) return payload.records;
		return [];
	}
	function appendTriageTable(root, title, payload, columns) {
		const section = el('section', { className: 'tm-cat-triage-section' });
		section.append(el('h4', { textContent: `${title} (${triageRows(payload).length})` }));
		const rows = triageRows(payload);
		if (!rows.length) {
			section.append(el('div', { className: 'tm-cat-help', textContent: 'No rows returned. The raw response is available below.' }));
		} else {
			const table = el('table', { className: 'tm-cat-triage-table' });
			const head = el('tr'); columns.forEach((column) => head.append(el('th', { textContent: column.label }))); table.append(el('thead', {}, [head]));
			const body = el('tbody'); rows.slice(0, 100).forEach((row) => { const tr = el('tr'); columns.forEach((column) => { const value = row?.[column.key]; tr.append(el('td', { textContent: value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value) })); }); body.append(tr); }); table.append(body); section.append(table);
		}
		section.append(el('details', {}, [el('summary', { textContent: 'Raw response' }), el('pre', { className: 'tm-cat-triage-raw', textContent: JSON.stringify(payload, null, 2) })]));
		root.append(section);
	}
	async function loadDriftTriage() {
		const root = document.getElementById(IDS.triageResults); if (!root) return;
		const values = triageValues(); root.innerHTML = ''; setStatus('Loading drift diagnostics...', 'neutral');
		const entriesUrl = buildTriageUrl('/staff/imbalanced-credit-account-entries', values, triageEntryFields);
		const recordsUrl = buildTriageUrl('/v1/balance-drift-records', values, triageDriftFields);
		try {
			const started = new Date().toISOString();
			const [entries, records] = await Promise.all([fetchTriageResponse(entriesUrl), fetchTriageResponse(recordsUrl)]);
			appendTriageTable(root, 'Imbalanced credit account entries', entries.result, [
				{ key: 'accountRef', label: 'Account ref' }, { key: 'creditAccountRef', label: 'Credit account' }, { key: 'driftCount', label: 'Drifts' }, { key: 'integratorCreditBalance', label: 'Integrator balance' }, { key: 'invoicingOutstandingBalance', label: 'Outstanding' }, { key: 'solved', label: 'Solved' }, { key: 'updatedAt', label: 'Updated' },
			]);
			appendTriageTable(root, 'Balance drift records', records.result, [
				{ key: 'creditAccountRef', label: 'Credit account' }, { key: 'saleRef', label: 'Sale ref' }, { key: 'reason', label: 'Reason' }, { key: 'transactionAmount', label: 'Transaction amount' }, { key: 'status', label: 'Status' }, { key: 'investigationNotes', label: 'Notes' }, { key: 'updatedAt', label: 'Updated' },
			]);
			const resultText = JSON.stringify({ imbalancedEntries: entries.result, balanceDriftRecords: records.result }, null, 2);
			setStatus('Drift diagnostics loaded', 'success');
			saveHistory({ started, method: 'GET/GET', path: `${entriesUrl.pathname}${entriesUrl.search} + ${recordsUrl.pathname}${recordsUrl.search}`, status: 200, body: '', response: resultText });
			renderHistory();
		} catch (error) {
			root.append(el('div', { className: 'tm-cat-danger', textContent: String(error.message || error) })); setStatus('Drift diagnostics failed', 'error');
		}
	}
	async function runDriftDetector() {
		const root = document.getElementById(IDS.triageResults); if (!root) return;
		const values = triageValues(); const accountRefs = String(values.accountRef || '').split(',').map((value) => value.trim()).filter(Boolean);
		if (!values.integrationKey || !accountRefs.length) { setStatus('Integration key and merchant account ref are required.', 'error'); return; }
		root.innerHTML = ''; setStatus('Starting imbalance detector...', 'neutral');
		try {
			const started = new Date().toISOString(); const url = new URL(`${API_BASE_PATH}/staff/detect-imbalanced-credit-accounts`, location.origin); const body = { accountRefs, integrationKey: values.integrationKey }; const { response, result } = await fetchTriageResponse(url, 'POST', body);
			root.append(el('section', { className: 'tm-cat-triage-section' }, [el('h4', { textContent: 'Detector response' }), el('pre', { className: 'tm-cat-triage-raw', textContent: JSON.stringify(result, null, 2) })]));
			setStatus(`Detector accepted (${response.status}); refresh diagnostics to read results.`, 'success'); saveHistory({ started, method: 'POST', path: url.pathname, status: response.status, body: JSON.stringify(body), response: JSON.stringify(result, null, 2) }); renderHistory();
		} catch (error) { root.append(el('div', { className: 'tm-cat-danger', textContent: String(error.message || error) })); setStatus('Detector failed', 'error'); }
	}
	function renderTriagePanel() {
		const root = document.getElementById(IDS.triage); if (!root) return; root.innerHTML = '';
		root.append(el('h3', { textContent: 'Drift triage' }), el('div', { className: 'tm-cat-help', textContent: 'GET-based imbalance and balance-drift diagnostics. The detector starts a documented detection workflow and may create or update diagnostic records, but it does not solve or repair entries.' }));
		const filters = el('div', { className: 'tm-cat-triage-filters' }); triageFields.forEach((field) => { const input = el('input', { name: field.key, type: field.type || 'text', value: triageValue(field), placeholder: field.key }); filters.append(el('div', { className: 'tm-cat-field' }, [el('label', { textContent: field.label }), input])); }); root.append(filters);
		root.append(el('div', { className: 'tm-cat-triage-actions' }, [el('button', { type: 'button', textContent: 'Load diagnostics', onclick: loadDriftTriage }), el('button', { type: 'button', textContent: 'Run imbalance detector', onclick: runDriftDetector })]));
		root.append(el('div', { id: IDS.triageResults, className: 'tm-cat-triage-results' }));
	}

	function ensureStyles() {
		if (document.getElementById('tm-cat-style')) return;
		const style = document.createElement('style'); style.id = 'tm-cat-style'; style.textContent = `
			#tm-cat-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483646;border:0;border-radius:999px;padding:13px 17px;background:#123b4a;color:#f6fbfa;font:600 13px/1.1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 12px 30px #09212b66;cursor:pointer}#tm-cat-launcher:hover{background:#1a5b68}
			#tm-cat-overlay{position:fixed;inset:0;z-index:2147483646;display:none;background:#071e26aa;backdrop-filter:blur(4px)}#tm-cat-modal{position:fixed;inset:4vh 3vw;z-index:2147483647;display:none;overflow:hidden;border:1px solid #6a9b9c66;border-radius:16px;background:#f5f3ed;color:#17333b;box-shadow:0 24px 70px #071e2666;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
			#tm-cat-header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:15px 18px;background:#123b4a;color:#f6fbfa}#tm-cat-header h2{margin:0;font-size:18px}#tm-cat-header small{color:#b7d6d0}#tm-cat-header button,#tm-cat-modal button{border:1px solid #7c9c9b;background:#fffaf0;color:#17333b;border-radius:7px;padding:8px 11px;cursor:pointer}#tm-cat-header button{background:#1c5963;color:#fff;border-color:#77a6a4}
			#tm-cat-body{display:grid;grid-template-columns:290px minmax(0,1fr);height:calc(100% - 69px)}#tm-cat-groups{overflow:auto;padding:14px;border-right:1px solid #c8d3cc}#tm-cat-main{min-width:0;overflow:auto;padding:16px}#tm-cat-groups h3{margin:13px 0 7px;color:#28616a;font-size:11px;letter-spacing:.08em;text-transform:uppercase}.tm-cat-op{display:block;width:100%;margin:4px 0;text-align:left}.tm-cat-op.active{background:#d5ebe4!important;border-color:#337e7d!important}.tm-cat-op small{display:block;color:#557276;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			#tm-cat-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}#tm-cat-toolbar input,#tm-cat-form input,#tm-cat-form textarea,#tm-cat-triage input{box-sizing:border-box;width:100%;border:1px solid #9bb5ad;border-radius:7px;background:#fffdf7;color:#17333b;padding:9px;font:inherit}#tm-cat-toolbar input{flex:1;min-width:180px}#tm-cat-form{display:grid;gap:12px}.tm-cat-field label{display:block;margin-bottom:4px;font-weight:600}.tm-cat-field textarea{min-height:260px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.tm-cat-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}.tm-cat-help{color:#557276;font-size:12px}.tm-cat-danger{color:#9b3d2f;font-weight:700}.tm-cat-status{margin-left:auto}.tm-cat-response{min-height:180px;max-height:38vh;overflow:auto;white-space:pre-wrap;border:1px solid #bdcbc4;border-radius:8px;background:#102b32;color:#e7f2e9;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.tm-cat-history{display:grid;gap:6px}.tm-cat-history button{text-align:left}.tm-cat-hidden{display:none!important}.tm-cat-triage{display:grid;gap:14px}.tm-cat-triage-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;padding:12px;border:1px solid #c8d3cc;border-radius:8px;background:#eef4ef}.tm-cat-triage-actions{display:flex;flex-wrap:wrap;gap:8px}.tm-cat-triage-results{display:grid;gap:14px}.tm-cat-triage-section{overflow:auto;border:1px solid #c8d3cc;border-radius:8px;background:#fffdf7;padding:10px}.tm-cat-triage-section h4{margin:0 0 8px;color:#28616a}.tm-cat-triage-table{width:100%;border-collapse:collapse;font-size:12px}.tm-cat-triage-table th,.tm-cat-triage-table td{padding:6px 8px;border:1px solid #d6dfd9;text-align:left;vertical-align:top;white-space:nowrap}.tm-cat-triage-table th{background:#dcebe5}.tm-cat-triage-raw{max-height:260px;overflow:auto;white-space:pre-wrap;background:#102b32;color:#e7f2e9;padding:10px;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
			@media(max-width:800px){#tm-cat-modal{inset:1vh 1vw}#tm-cat-body{grid-template-columns:1fr}#tm-cat-groups{max-height:30vh;border-right:0;border-bottom:1px solid #c8d3cc}}
		`;
		document.head.append(style);
	}

	function showTriageView() {
		state.activeView = 'triage';
		const form = document.getElementById(IDS.form); const triage = document.getElementById(IDS.triage);
		if (form) form.style.display = 'none'; if (triage) triage.style.display = 'grid';
		renderTriagePanel(); renderGroups();
	}
	function showOperationView() {
		state.activeView = 'operation'; renderForm(); renderGroups();
	}
	function renderGroups() {
		const root = document.getElementById(IDS.groupList); if (!root) return; root.innerHTML = '';
		root.append(el('button', { className: `tm-cat-op${state.activeView === 'triage' ? ' active' : ''}`, type: 'button', textContent: 'Drift triage', onclick: showTriageView }));
		Object.entries(groupedOperations()).forEach(([group, groupOperations]) => { if (group === 'Staff / dangerous' && !state.advanced) return; root.append(el('h3', { textContent: `${group} (${groupOperations.length})` })); groupOperations.forEach((operation) => { const button = el('button', { className: `tm-cat-op${state.activeView === 'operation' && operation.key === state.operationKey ? ' active' : ''}`, type: 'button', onclick: () => { state.operationKey = operation.key; showOperationView(); } }, [document.createTextNode(`${operation.method} ${operation.path}`)]); root.append(button); }); });
	}
	function renderForm() {
		state.activeView = 'operation'; const operation = currentOperation(); const form = document.getElementById(IDS.form); const triage = document.getElementById(IDS.triage); if (!form) return; if (triage) triage.style.display = 'none'; form.style.display = 'grid'; form.innerHTML = '';
		form.append(el('div', { className: 'tm-cat-path', textContent: `${operation.method} ${operation.path}` }));
		form.append(el('div', { className: operation.dangerous ? 'tm-cat-danger' : 'tm-cat-help', textContent: operation.dangerous ? 'This operation is gated. Advanced mode and confirmation are required.' : 'Same-origin request with the current MerchantOS session.' }));
		if (operation.pathFields.length) { const fields = el('div', {}, [el('strong', { textContent: 'Path parameters' })]); operation.pathFields.forEach((field) => { const input = el('input', { name: field, placeholder: field, value: prefillForField(field) }); fields.append(el('div', { className: 'tm-cat-field' }, [el('label', { textContent: field }), input])); }); form.append(fields); }
		const queryFields = queryFieldsForOperation(operation); const query = el('div', {}, [el('strong', { textContent: 'Query parameters' }), el('div', { className: 'tm-cat-help', textContent: queryFields.length ? 'Optional documented filters.' : 'Optional query string, one key=value pair per line.' })]);
		queryFields.forEach((field) => { const input = el('input', { name: `query.${field.key}`, type: field.type || 'text', placeholder: field.placeholder || '', value: prefillForField(field.key) }); query.append(el('div', { className: 'tm-cat-field' }, [el('label', { textContent: field.label }), input])); });
		query.append(el('textarea', { name: 'rawQuery', placeholder: queryFields.length ? 'Additional query parameters: key=value' : 'limit=100\npage=1' })); form.append(query);
		const bodyFields = bodyFieldsForOperation(operation); const body = el('div', {}, [el('strong', { textContent: 'Request body' })]);
		bodyFields.forEach((field) => { const input = el('input', { name: `body.${field.key}`, type: field.type || 'text', placeholder: field.placeholder || '', value: prefillForField(field.key) }); body.append(el('div', { className: 'tm-cat-field' }, [el('label', { textContent: field.label }), input])); });
		body.append(el('div', { className: 'tm-cat-help', textContent: bodyFields.length ? 'Nested objects and arrays can be supplied as JSON below.' : 'Enter the JSON request body.' }));
		body.append(el('textarea', { name: 'body', placeholder: '{\n  "example": "value"\n}' })); form.append(body);
		form.append(el('button', { type: 'button', textContent: `Send ${operation.method}`, onclick: sendCurrentOperation }));
		const response = document.getElementById(IDS.response); response.textContent = 'Ready.';
	}
	function collectForm() { const form = document.getElementById(IDS.form); const values = {}; form.querySelectorAll('input, textarea').forEach((input) => { values[input.name] = input.value; }); return values; }
	function buildUrl(operation, values) { let path = operation.path; operation.pathFields.forEach((field) => { path = path.replace(`{${field}}`, encodeURIComponent(values[field] || '')); }); const url = new URL(`${API_BASE_PATH}${path}`, location.origin); queryFieldsForOperation(operation).forEach((field) => { const value = values[`query.${field.key}`]; if (value !== undefined && value !== '') url.searchParams.set(field.key, value); }); (values.rawQuery || '').split('\n').forEach((line) => { const separator = line.indexOf('='); if (separator > 0) url.searchParams.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim()); }); return url; }
	function buildBody(operation, values) {
		const rawBody = (values.body || '').trim();
		const fields = bodyFieldsForOperation(operation);
		if (!fields.length) return rawBody;
		let payload = {};
		if (rawBody) {
			try {
				payload = JSON.parse(rawBody);
			} catch (error) {
				throw new Error(`Request body is not valid JSON: ${error.message}`);
			}
			if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Request body must be a JSON object.');
		}
		fields.forEach((field) => {
			const value = values[`body.${field.key}`];
			if (value === undefined || value === '') return;
			const nextValue = field.type === 'number' ? Number(value) : value;
			const parts = field.key.split('.');
			let target = payload;
			parts.slice(0, -1).forEach((part) => {
				if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {};
				target = target[part];
			});
			target[parts[parts.length - 1]] = nextValue;
		});
		return Object.keys(payload).length ? JSON.stringify(payload) : '';
	}
	async function sendCurrentOperation() {
		const operation = currentOperation(); if (operation.dangerous && !state.advanced) return setStatus('Enable advanced mode before using this operation.', 'error'); if (operation.dangerous && !confirm(`Send dangerous operation?\n\n${operation.method} ${operation.path}`)) return;
		const values = collectForm(); const url = buildUrl(operation, values); const responseEl = document.getElementById(IDS.response); setStatus(`Sending ${operation.method} ${url.pathname}...`); responseEl.textContent = 'Requesting...';
		let rawBody;
		try { rawBody = buildBody(operation, values); } catch (error) { responseEl.textContent = error.message; setStatus('Invalid request body', 'error'); return; }
		const init = { method: operation.method, credentials: 'include', headers: { Accept: 'application/json, text/plain, */*' } }; if (rawBody && !['GET', 'HEAD'].includes(operation.method)) { init.body = rawBody; init.headers['Content-Type'] = 'application/json'; }
		const started = new Date().toISOString(); let resultText = '';
		try { const response = await fetch(url, init); const contentType = response.headers.get('content-type') || ''; resultText = contentType.includes('json') ? JSON.stringify(await response.json(), null, 2) : await response.text(); responseEl.textContent = `HTTP ${response.status} ${response.statusText}\n\n${resultText}`; setStatus(`Completed ${response.status}`, response.ok ? 'success' : 'error'); saveHistory({ started, method: operation.method, path: url.pathname + url.search, status: response.status, body: rawBody, response: resultText }); renderHistory(); } catch (error) { resultText = String(error.stack || error); responseEl.textContent = resultText; setStatus('Request failed', 'error'); }
	}
	function setStatus(message, tone = 'neutral') { const node = document.getElementById(IDS.status); if (node) { node.textContent = message; node.dataset.tone = tone; } }
	function renderHistory() { const root = document.getElementById(IDS.history); if (!root) return; root.innerHTML = ''; state.history.slice(0, 12).forEach((entry) => { root.append(el('button', { type: 'button', textContent: `${entry.status} ${entry.method} ${entry.path}`, onclick: () => { document.getElementById(IDS.response).textContent = entry.response || ''; } })); }); }
	function setVisible(visible) { document.getElementById(IDS.overlay).style.display = visible ? 'block' : 'none'; document.getElementById(IDS.modal).style.display = visible ? 'block' : 'none'; state.modalOpen = visible; }
	function createModal() {
		if (document.getElementById(IDS.launcher)) return; ensureStyles(); state.settings = loadSettings(); state.history = loadHistory(); state.advanced = Boolean(state.settings.advanced); state.operationKey = operations[0].key;
		const launcher = el('button', { id: IDS.launcher, type: 'button', textContent: 'Credit Account Toolbox', onclick: () => { setVisible(true); renderGroups(); renderForm(); renderHistory(); } }); const overlay = el('div', { id: IDS.overlay, onclick: () => setVisible(false) }); const modal = el('div', { id: IDS.modal });
		modal.append(el('div', { id: 'tm-cat-header' }, [el('div', {}, [el('h2', { textContent: 'MerchantOS Credit Account Toolbox' }), el('small', { textContent: 'Same-origin API console for the customer SPA' })]), el('button', { type: 'button', textContent: 'Close', onclick: () => setVisible(false) })]));
		const groups = el('div', { id: IDS.groupList }); const main = el('main', { id: 'tm-cat-main' }); const toolbar = el('div', { id: 'tm-cat-toolbar' }); const advanced = el('label', {}, [el('input', { type: 'checkbox', checked: state.advanced, onchange: (event) => { state.advanced = event.target.checked; saveSettings({ advanced: state.advanced }); renderGroups(); } }), document.createTextNode(' Advanced mode')]); toolbar.append(el('button', { type: 'button', textContent: 'Drift triage', onclick: showTriageView }), advanced, el('span', { id: IDS.context, className: 'tm-cat-help', textContent: customerContextLabel() }), el('span', { id: IDS.status, className: 'tm-cat-status', textContent: 'Ready.' })); main.append(toolbar, el('section', { id: IDS.triage, className: 'tm-cat-triage', style: 'display:none' }), el('section', { id: IDS.form }), el('h3', { textContent: 'Recent request history' }), el('div', { id: IDS.history, className: 'tm-cat-history' }), el('h3', { textContent: 'Response' }), el('pre', { id: IDS.response, className: 'tm-cat-response', textContent: 'Ready.' })); modal.append(el('div', { id: 'tm-cat-body' }, [groups, main])); document.body.append(launcher, overlay, modal); renderGroups(); renderForm();
	}
	async function bootstrap() { if (isCustomerLocation()) { createModal(); renderCustomerContextLabel(); await loadCustomerContext(); } else { const launcher = document.getElementById(IDS.launcher); if (launcher) launcher.remove(); const modal = document.getElementById(IDS.modal); if (modal) setVisible(false); } }
	function waitForBody() { if (document.body) return Promise.resolve(); return new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true })); }
	// route hook is installed once by the master loader; subscribe instead of patching history ourselves
	waitForBody().then(() => { window.__mkl && window.__mkl.onRouteChange(bootstrap); bootstrap(); });
})();
