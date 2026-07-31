type DueRecord = {
  next_due_on: string;
};

export function isDueOn(record: DueRecord, today: string): boolean {
  return record.next_due_on <= today;
}

export function selectDueRecords<T extends DueRecord>(records: T[], today: string): T[] {
  return records.filter((record) => isDueOn(record, today));
}

export function findNextUpcoming<T extends DueRecord>(records: T[], today: string): T | null {
  return records.find((record) => !isDueOn(record, today)) ?? null;
}
