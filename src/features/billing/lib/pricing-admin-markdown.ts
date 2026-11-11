import {
  CHARGE_COLUMNS,
  CHARGE_FOOTNOTE,
  chargeRows,
  chargesExplained,
  typicalTurnSentence,
} from './charge-rows';
import {
  catalogSentence,
  creditRuleRows,
  marginSummary,
  packageRows,
  planColumns,
  planNotes,
  planTableRows,
} from './pricing-admin-model';
import {
  billSummaryLabels,
  billTotals,
  COST_SCALE_COLUMNS,
  customersToCover,
  keptPerSubscriptionSentence,
  NO_VENDOR_BILLS,
  vendorBillRows,
  vendorBillsIntro,
} from './vendor-bill-rows';

function bullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join('\n');
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function vendorBillsTable(): string {
  const totals = billTotals();
  const cover = customersToCover();
  const labels = billSummaryLabels();

  return table(
    [
      'Vendor',
      'What it does',
      'What makes it grow',
      ...COST_SCALE_COLUMNS.map((column) => column.label),
    ],
    [
      ...vendorBillRows().map((row) => [
        row.name,
        row.role,
        row.grows,
        ...COST_SCALE_COLUMNS.map((column) => row.valuesByScale[column.key]),
      ]),
      [labels.total, '', '', ...COST_SCALE_COLUMNS.map((column) => totals[column.key].money)],
      [labels.cover, '', '', ...COST_SCALE_COLUMNS.map((column) => cover[column.key])],
    ],
  );
}

function plansSection(): string {
  const columns = planColumns();
  return table(
    ['', ...columns.map((column) => column.name)],
    planTableRows().map((row) => [
      row.label,
      ...columns.map((column) => row.valuesByTier[column.tier]),
    ]),
  );
}

export async function pricingAdminMarkdown(): Promise<string> {
  const margin = marginSummary();
  const vendorBills = vendorBillRows();

  return [
    '# Pricing',

    '## Your margin',
    margin.headline,
    margin.sentence,
    bullets(margin.rows.map((row) => `${row.label}: ${row.value}`)),

    '## Your plans',
    'Both plans charge the same for a credit. They differ by their smallest package and by what they let a customer run.',
    plansSection(),
    '### Credit packages',
    table(
      ['Credits', 'Price', 'Plans'],
      packageRows().map((row) => [row.creditsLabel, row.monthlyPrice, row.plans]),
    ),
    bullets(planNotes()),

    '## What gets charged',
    ...chargesExplained(),
    typicalTurnSentence(),
    table(
      ['What', CHARGE_COLUMNS.vendorRate, CHARGE_COLUMNS.credits, CHARGE_COLUMNS.customerPaid],
      chargeRows().map((row) => [
        `${row.label} (${row.detail})`,
        row.vendorRate,
        row.credits,
        row.customerPaid,
      ]),
    ),
    CHARGE_FOOTNOTE,

    '## Credit rules',
    bullets(creditRuleRows().map((row) => `${row.label}: ${row.value}`)),

    '## Your vendor bills',
    'Every service below is paid. Each has a free tier that covers a small app and a bill that grows with use.',
    ...(vendorBills.length === 0
      ? [NO_VENDOR_BILLS]
      : [...vendorBillsIntro(), vendorBillsTable(), keptPerSubscriptionSentence()]),

    '## Payments',
    catalogSentence(),
    'The page checks whether Stripe matches these prices. When it is out of date, use the "Fix your Stripe catalog" button on the page. The fix changes your Stripe account and needs your clear approval before it runs.',
  ].join('\n\n');
}
