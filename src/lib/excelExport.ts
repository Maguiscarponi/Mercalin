import ExcelJS from "exceljs";

// Excel con diseño real (encabezado con color de marca, filas alternadas, columnas
// alineadas y con formato numérico) — la librería liviana que se usaba antes (xlsx,
// community edition) no soporta estilos de celda al escribir .xlsx, solo datos
// planos. exceljs sí, y es la razón de este módulo aparte (ver auditoría UX).

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
  /** Formato numérico de Excel, ej. '"$"#,##0.00' para moneda, '0.0"%"' para porcentaje. */
  numFmt?: string;
  align?: "left" | "right" | "center";
}

export interface ExcelSheet {
  name: string;
  columns: ExcelColumn[];
  rows: Record<string, unknown>[];
}

const BRAND_FILL = "FF4F46E5"; // indigo-600, el mismo acento que ya usa el resto del sistema
const HEADER_TEXT = "FFFFFFFF";
const ZEBRA_FILL = "FFF4F4F5"; // stone-100

export const CURRENCY_FMT = '"$"#,##0.00';
export const INT_FMT = "#,##0";
export const PCT_FMT = '0.0"%"';

export async function exportStyledExcel(sheets: ExcelSheet[], filename: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Punto Simple POS";
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? Math.max(12, c.header.length + 2),
    }));

    const headerRow = ws.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_FILL } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    sheet.rows.forEach((rowData, i) => {
      const row = ws.addRow(rowData);
      const isZebra = i % 2 === 1;
      row.eachCell((cell, colNumber) => {
        const col = sheet.columns[colNumber - 1];
        if (col?.numFmt) cell.numFmt = col.numFmt;
        cell.alignment = { horizontal: col?.align ?? "left", vertical: "middle" };
        if (isZebra) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_FILL } };
        }
        cell.border = { bottom: { style: "thin", color: { argb: "FFE7E5E4" } } };
      });
    });

    if (sheet.columns.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
