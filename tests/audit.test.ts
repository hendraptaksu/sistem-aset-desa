// T10 Riwayat Perubahan: listAuditLog untuk viewer di TutupTab.
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { insertAuditLog, listAuditLog } from '../src/db/repository.js';
import type { AuditLog } from '../src/core/types.js';

function dbKosong(): Database.Database {
  return openDb(':memory:');
}

describe('T10 listAuditLog', () => {
  it('kembali urut tanggal DESC, kosong bila belum ada', () => {
    const db = dbKosong();
    expect(listAuditLog(db)).toEqual([]);

    const a1: AuditLog = {
      id: 'audit-1',
      tanggal: '2026-01-10T10:00:00.000Z',
      aksi: 'CREATE t-1',
      alasan: 'Koreksi struk susulan Desember',
      data_lama_json: '{}',
    };
    const a2: AuditLog = {
      id: 'audit-2',
      tanggal: '2026-02-15T10:00:00.000Z',
      aksi: 'CREATE t-2',
      alasan: 'Susulan parkir Januari',
      data_lama_json: '{}',
    };
    insertAuditLog(db, a1);
    insertAuditLog(db, a2);

    const rows = listAuditLog(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe('audit-2');
    expect(rows[1]!.id).toBe('audit-1');
    expect(rows[0]!.alasan).toBe('Susulan parkir Januari');
  });
});
