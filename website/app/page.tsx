import { MarketingPage } from "@/components/MarketingPage";
import { site } from "@/content";

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: site.name,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Android; macOS; Linux; Windows",
  description: site.description,
  codeRepository: site.urls.repository,
  license: site.urls.license,
  downloadUrl: "https://www.npmjs.com/package/mobily",
  isAccessibleForFree: true,
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <MarketingPage />
    </>
  );
}
