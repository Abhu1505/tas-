import React, { useState } from "react";

/**
 * 💳 Incoming Payments tab with expandable rows.
 *
 * FIX: Previously clicking a payment row did nothing because the row's
 * onClick toggled state that was never used to render the detail panel
 * (and stopPropagation was missing on inner buttons). Now each row has a
 * proper toggle chevron and an expanded detail section rendered directly
 * beneath it.
 */

const SAMPLE_PAYMENTS = [
  {
    id: "INC-1001",
    payer: "Acme Corporation",
    amount: 4250.0,
    currency: "USD",
    method: "Bank Transfer (ACH)",
    date: "2026-10-24",
    status: "Completed",
    reference: "REF-88213-ACME",
    note: "Invoice #INV-2041 — Q4 retainer.",
  },
  {
    id: "INC-1002",
    payer: "Globex LLC",
    amount: 980.5,
    currency: "USD",
    method: "Credit Card",
    date: "2026-10-25",
    status: "Pending",
    reference: "REF-99120-GLBX",
    note: "Subscription renewal, annual plan.",
  },
  {
    id: "INC-1003",
    payer: "Initech GmbH",
    amount: 12750.0,
    currency: "EUR",
    method: "Wire Transfer (SWIFT)",
    date: "2026-10-26",
    status: "Completed",
    reference: "REF-11877-INIT",
    note: "Enterprise license — 3-year term.",
  },
];

const statusColor = {
  Completed: "#16a34a",
  Pending: "#d97706",
  Failed: "#dc2626",
};

export default function IncomingPayments() {
  // Set of currently-expanded payment ids (multiple rows may be open at once)
  const [expandedIds, setExpandedIds] = useState(new Set());

  const toggleRow = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isAllExpanded = expandedIds.size === SAMPLE_PAYMENTS.length;

  const toggleAll = () => {
    setExpandedIds(isAllExpanded ? new Set() : new Set(SAMPLE_PAYMENTS.map((p) => p.id)));
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>💳 Incoming Payments</h2>
        <button onClick={toggleAll} style={btnStyle}>
          {isAllExpanded ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb", color: "#6b7280" }}>
            <th style={{ width: 36 }} aria-label="expand" />
            <th style={cellHead}>ID</th>
            <th style={cellHead}>Payer</th>
            <th style={cellHead}>Amount</th>
            <th style={cellHead}>Date</th>
            <th style={cellHead}>Status</th>
          </tr>
        </thead>
        <tbody>
          {SAMPLE_PAYMENTS.map((p) => {
            const isOpen = expandedIds.has(p.id);
            return (
              <React.Fragment key={p.id}>
                <tr
                  onClick={() => toggleRow(p.id)}
                  aria-expanded={isOpen}
                  style={{
                    cursor: "pointer",
                    borderBottom: "1px solid #e5e7eb",
                    background: isOpen ? "#f3f6ff" : "transparent",
                  }}
                >
                  <td style={cell}>
                    {/* Chevron rotates when open */}
                    <span
                      style={{
                        display: "inline-block",
                        transition: "transform 0.2s ease",
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                        color: "#6b7280",
                      }}
                    >
                      ▶
                    </span>
                  </td>
                  <td style={cell}>{p.id}</td>
                  <td style={cell}>{p.payer}</td>
                  <td style={cell}>
                    {p.currency === "EUR" ? "€" : "$"}
                    {p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td style={cell}>{p.date}</td>
                  <td style={{ ...cell, color: statusColor[p.status], fontWeight: 600 }}>
                    {p.status}
                  </td>
                </tr>

                {/* Expanded detail row — only rendered when this row is open */}
                {isOpen && (
                  <tr>
                    <td colSpan={6} style={{ padding: 0, borderBottom: "1px solid #e5e7eb" }}>
                      <div
                        style={{
                          padding: "12px 16px 16px 48px",
                          background: "#f9fafb",
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                          gap: 12,
                        }}
                      >
                        <Detail label="Payment Method" value={p.method} />
                        <Detail label="Reference" value={p.reference} />
                        <Detail label="Currency" value={p.currency} />
                        <Detail label="Note" value={p.note} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: "#111827" }}>{value}</div>
    </div>
  );
}

const cell = { padding: "10px 12px", fontSize: 14 };
const cellHead = { padding: "8px 12px", fontSize: 13, fontWeight: 600 };
const btnStyle = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  fontSize: 13,
};
