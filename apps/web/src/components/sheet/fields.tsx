import React, { useState } from "react";

/**
 * Inputs "commit on blur": guardam o texto localmente enquanto o usuário digita
 * e só chamam onCommit ao sair do campo / Enter. Evita um character:update por tecla.
 */

const base =
  "bg-[#141414] border border-[#2d2417] rounded px-1.5 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-[#d4af37] disabled:opacity-60 disabled:cursor-not-allowed";

interface NumInputProps {
  value: number | null;
  onCommit: (value: number | null) => void;
  /** Se true, campo vazio vira null (ex.: "usar a fórmula"). Senão, vazio = reverte. */
  allowEmpty?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  title?: string;
  id?: string;
}

export function NumInput({ value, onCommit, allowEmpty, disabled, placeholder, className, title, id }: NumInputProps) {
  const external = value === null ? "" : String(value);
  const [text, setText] = useState(external);
  const [prev, setPrev] = useState(external);
  if (prev !== external) {
    setPrev(external);
    setText(external);
  }
  const commit = () => {
    const t = text.trim();
    if (t === "") {
      if (allowEmpty) {
        if (value !== null) onCommit(null);
      } else setText(external);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) {
      setText(external);
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      title={title}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`${base} w-12 text-center font-mono ${className ?? ""}`}
    />
  );
}

interface TextInputProps {
  value: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  id?: string;
}

export function TextInput({ value, onCommit, disabled, placeholder, className, maxLength, id }: TextInputProps) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(value);
  }
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <input
      id={id}
      type="text"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`${base} ${className ?? ""}`}
    />
  );
}

interface TextAreaProps {
  value: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  className?: string;
}

export function TextArea({ value, onCommit, disabled, placeholder, rows = 3, className }: TextAreaProps) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(value);
  }
  return (
    <textarea
      value={text}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      className={`${base} w-full resize-y ${className ?? ""}`}
    />
  );
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
  title?: string;
  id?: string;
}

export function Select({ value, onChange, options, disabled, className, title, id }: SelectProps) {
  return (
    <select id={id} value={value} disabled={disabled} title={title} onChange={(e) => onChange(e.target.value)} className={`${base} ${className ?? ""}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[#2d2417] pb-1 mb-2">
      <h3 className="text-[10px] font-serif font-bold uppercase tracking-widest text-[#d4af37]">{children}</h3>
      {right}
    </div>
  );
}

export const smallBtn =
  "flex items-center gap-1 px-2 py-0.5 rounded border border-[#3d3d3d] hover:border-[#d4af37] text-[10px] text-zinc-300 hover:text-[#d4af37] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#3d3d3d] disabled:hover:text-zinc-300";

export const rollBtn =
  "flex items-center justify-center w-6 h-6 rounded border border-[#d4af37]/40 bg-[#2d2417]/40 text-[#d4af37] hover:bg-[#3d311f] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0";
