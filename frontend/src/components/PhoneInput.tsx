import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Country,
  COUNTRIES,
  getCountryByIso,
} from "../data/countries";
import { api } from "../api/client";

type PhoneInputProps = {
  value: string;
  onChange: (fullPhone: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  "data-testid"?: string;
};

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
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [number, setNumber] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

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
  }, []); // only on mount

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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Geo: pre-select country by IP
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ country_code?: string | null }>("/geo/country-code/")
      .then(({ data }) => {
        if (cancelled) return;
        const iso = data.country_code;
        if (typeof iso === "string") {
          const c = getCountryByIso(iso.toUpperCase());
          if (c) setCountry(c);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div ref={containerRef} className="relative">
    <div className={`flex rounded-lg border overflow-hidden focus-within:ring-2 focus-within:border-transparent ${error ? "border-red-500 focus-within:ring-red-500" : "border-gray-300 focus-within:ring-blue-500"}`}>
      {/* Country selector */}
      <button
        type="button"
        onClick={() => setDropdownOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 border-r border-gray-300 text-left min-w-0 hover:bg-gray-100 focus:outline-none focus:ring-0 disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={dropdownOpen}
        aria-label="Country"
      >
        <span className="text-lg leading-none" aria-hidden>{country.flag}</span>
        <span className="text-sm font-medium text-gray-700">+{country.dialCode}</span>
        <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        className="flex-1 min-w-0 px-3 py-2 focus:outline-none focus:ring-0 border-0"
      />

      {/* Dropdown */}
      {dropdownOpen && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-hidden flex flex-col"
          role="listbox"
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search country..."
            className="m-2 px-3 py-2 border border-gray-200 rounded text-sm"
            autoFocus
          />
          <div className="overflow-y-auto flex-1 min-h-0">
            {filteredCountries.map((c) => (
              <button
                key={c.iso}
                type="button"
                role="option"
                aria-selected={c.iso === country.iso}
                onClick={() => handleCountrySelect(c)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 ${
                  c.iso === country.iso ? "bg-blue-50 text-blue-700" : ""
                }`}
              >
                <span className="text-lg">{c.flag}</span>
                <span className="text-sm">+{c.dialCode}</span>
                <span className="text-sm text-gray-600 truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
