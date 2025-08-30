// src/pages/index.tsx
import dynamic from "next/dynamic";
const BurritoPrivateFunding = dynamic(() => import("@/components/BurritoPrivateFunding"), { ssr: false });

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "32px auto", padding: 16 }}>
      <BurritoPrivateFunding />
    </main>
  );
}
