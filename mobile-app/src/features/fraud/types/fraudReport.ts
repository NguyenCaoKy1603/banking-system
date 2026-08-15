export type FraudReportRequest = {
  accountId: string;
  transactionId: string;
  reason: string;
};

export type FraudReportResponse = {
  reportId: string;
  status: "RECEIVED";
  createdAt: string;
};
