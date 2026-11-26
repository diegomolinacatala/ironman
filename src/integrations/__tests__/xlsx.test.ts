import { strToU8, zipSync } from 'fflate';

import { readTable, tableToPlan } from '@/domain/planImportTable';

import { columnIndex, readXlsx, XlsxError } from '../files/xlsx';

/** A tiny but real .xlsx: workbook → rels → sheet2.xml (not sheet1, to follow the relationship), shared strings. */
function workbook(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Plan" sheetId="1" r:id="rId7"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId8" Target="styles.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(
      '<sst><si><t>Fecha</t></si><si><t>Deporte</t></si><si><t>Duración</t></si><si><r><t>Rodaje </t></r><r><t xml:space="preserve">Z2 &amp; técnica</t></r></si><si><t>Bici</t></si><si><t>Notas</t></si></sst>',
    ),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Otra hoja</t></is></c></row></sheetData></worksheet>'),
    'xl/worksheets/sheet2.xml': strToU8(
      '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="E1" t="s"><v>5</v></c></row>' +
        '<row r="2"><c r="A2"><v>46363</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>0.03125</v></c><c r="E2" t="inlineStr"><is><t>suave</t></is></c></row>' +
        '<row r="3"/>' +
        '<row r="4"><c r="A4"><f>A2+2</f><v>46365</v></c><c r="B4" t="s"><v>4</v></c><c r="C4"><v>90</v></c></row>' +
        '</sheetData></worksheet>',
    ),
  });
}

describe('xlsx reader', () => {
  test('first sheet by relationship, shared + inline strings, gaps kept, empty rows dropped', () => {
    expect(readXlsx(workbook())).toEqual([
      ['Fecha', 'Deporte', 'Duración', '', 'Notas'],
      ['46363', 'Rodaje Z2 & técnica', '0.03125', '', 'suave'],
      ['46365', 'Bici', '90'],
    ]);
  });

  test('the table parser understands Excel serial dates and day fractions', () => {
    const plan = tableToPlan(readTable(readXlsx(workbook())), 'xlsx');
    expect(plan.sessions.map((s) => [s.sourceDate, s.sport, s.durationMin, s.intensity])).toEqual([
      ['2026-12-07', 'run', 45, 'endurance'],
      ['2026-12-09', 'bike', 90, 'endurance'],
    ]);
  });

  test('column letters and broken files', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AB3')).toBe(27);
    expect(() => readXlsx(strToU8('not a zip'))).toThrow(XlsxError);
  });
});
