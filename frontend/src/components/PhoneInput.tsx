import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Country,
  COUNTRIES,
  getCountryByIso,
} from "../data/countries";
import { api } from "../api/client";
import { AnchoredPortal } from "./TopLayerPortal";

type PhoneInputProps = {
  value: string;
  onChange: (fullPhone: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  "data-testid"?: string;
};

const PHONE_INPUT_COUNTRY_STORAGE_KEY = "auth.phoneInputCountry";

/**
 * Phone input in Telegram style:
 * - Left: country selector (flag + dial code) with dropdown
 * - Right: number input (e.g. 917...)
 * - Full phone: +7 917... (built on submit)
 */
export function PhoneInput({
  value,
  onChange,
  onBlur,
  placeholder = "917 123 45 67",
  error,
  disabled = false,
  "data-testid": dataTestId,
}: PhoneInputProps) {
  const [country, setCountry] = useState<Country>(() => {
    if (typeof window === "undefined") return COUNTRIES[0];
    const savedIso = window.sessionStorage.getItem(PHONE_INPUT_COUNTRY_STORAGE_KEY);
    return (savedIso && getCountryByIso(savedIso)) || COUNTRIES[0];
  });
  const [number, setNumber] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const persistCountry = useCallback((nextCountry: Country) => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(PHONE_INPUT_COUNTRY_STORAGE_KEY, nextCountry.iso);
  }, []);

  // Parse incoming value into country + number
  useEffect(() => {
    if (!value || value === getFullPhone(country, number)) return;
    const m = value.match(/^\+(\d{1,4})(.*)$/);
    if (m) {
      const [, codePart, rest] = m;
      let found: Country | undefined;
      for (let len = Math.min(4, codePart.length); len >= 1; len--) {
        const code = codePart.slice(0, len);
        found = COUNTRIES.find((c) => c.dialCode === code);
        if (found) {
          setCountry(found);
          persistCountry(found);
          const num = (codePart.slice(len) + rest).replace(/\D/g, "");
          setNumber(num);
          break;
        }
      }
      if (!found) {
        setNumber(value.replace(/\D/g, "").slice(0, 15));
      }
    } else {
      setNumber(value.replace(/\D/g, "").slice(0, 15));
    }
  }, [country, number, value, persistCountry]); // sync from initial value after mount/remount

  const getFullPhone = useCallback((c: Country, num: string) => {
    const n = num.replace(/\D/g, "");
    if (!n) return "";
    return `+${c.dialCode}${n}`;
  }, []);

  const notifyChange = useCallback(
    (c: Country, num: string) => {
      onChange(getFullPhone(c, num));
    },
    [onChange, getFullPhone]
  );

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, "").slice(0, 15);
    setNumber(v);
    notifyChange(country, v);
  };

  const handleCountrySelect = (c: Country) => {
    setCountry(c);
    persistCountry(c);
    setDropdownOpen(false);
    setSearch("");
    notifyChange(c, number);
  };

  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        c.iso.toLowerCase().includes(q)
    );
  }, [search]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Geo: pre-select country by IP
  useEffect(() => {
    let cancelled = false;
    if (value) return;
    if (typeof window !== "undefined" && window.sessionStorage.getItem(PHONE_INPUT_COUNTRY_STORAGE_KEY)) {
      return;
    }
    api
      .get<{ country_code?: string | null }>("/geo/country-code/")
      .then(({ data }) => {
        if (cancelled) return;
        const iso = data.country_code;
        if (typeof iso === "string") {
          const c = getCountryByIso(iso.toUpperCase());
          if (c) {
            setCountry(c);
            persistCountry(c);
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [persistCountry, value]);

  return (
    <div ref={containerRef} className="relative">
    <div className={`ui-field-shell flex overflow-hidden rounded-[18px] border transition-[border-color,box-shadow,background-color] focus-within:bg-white focus-within:ring-4 ${error ? "border-rose-300 focus-within:ring-rose-100" : "focus-within:border-sky-300 focus-within:ring-sky-100"}`}>
      {/* Country selector */}
      <button
        type="button"
        onClick={() => setDropdownOpen((o) => !o)}
        disabled={disabled}
        className="ui-picker-tile flex min-w-0 items-center gap-2 rounded-none border-r border-slate-200 px-3 py-3 text-left focus:outline-none focus:ring-0 disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={dropdownOpen}
        aria-label="Country"
      >
        <span className="text-lg leading-none" aria-hidden>{country.flag}</span>
        <span className="text-sm font-medium text-slate-700">+{country.dialCode}</span>
        <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Number input */}
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={number}
        onChange={handleNumberChange}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={dataTestId}
        className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-base font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0 sm:text-lg"
      />

      {/* Dropdown */}
      {dropdownOpen && (
        <AnchoredPortal
          anchorRef={containerRef}
          portalRef={dropdownRef}
          width="anchor"
          offset={8}
          className="ui-popover-surface flex max-h-72 flex-col overflow-hidden rounded-2xl"
        >
          <div role="listbox" className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-slate-100 p-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search country..."
                className="ui-field-shell block w-full rounded-xl px-3 py-2 text-sm text-slate-700 outline-none transition-[border-color,box-shadow] focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1 min-h-0">
              {filteredCountries.map((c) => (
                <button
                  key={c.iso}
                  type="button"
                  role="option"
                  aria-selected={c.iso === country.iso}
                  onClick={() => handleCountrySelect(c)}
                  className={`ui-list-row flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm ${
                    c.iso === country.iso ? "ui-list-row-active text-sky-700" : "text-slate-700"
                  }`}
                >
                  <span className="text-lg">{c.flag}</span>
                  <span className="text-sm">+{c.dialCode}</span>
                  <span className="truncate text-sm text-slate-500">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        </AnchoredPortal>
      )}
    </div>
    </div>
  );
}
