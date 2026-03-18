export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Outfit", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        blue: {
          50: "#e6f5fc",
          100: "#b3e2f6",
          200: "#80cef0",
          300: "#4dbae9",
          400: "#1aa6e3",
          500: "#0892d4",
          600: "#0697d7",
          700: "#057eb8",
          800: "#046599",
          900: "#034c7a",
        },
      },
    },
  },
  plugins: [],
};
