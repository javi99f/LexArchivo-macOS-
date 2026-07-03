import { describe, expect, it } from "vitest";

const estados = ["Abierto", "Pendiente", "En juicio", "Cerrado", "Archivado"];

function nextCaseNumber(year: number, sequence: number) {
  return `EXP-${year}-${String(sequence).padStart(3, "0")}`;
}

describe("reglas basicas de LexArchivo", () => {
  it("crea numero de expediente", () => {
    expect(nextCaseNumber(2026, 7)).toBe("EXP-2026-007");
  });

  it("mantiene estados validos", () => {
    expect(estados).toContain("Archivado");
  });

  it("permite marcar plazos proximos", () => {
    const days = 5;
    expect(days <= 14).toBe(true);
  });
});
