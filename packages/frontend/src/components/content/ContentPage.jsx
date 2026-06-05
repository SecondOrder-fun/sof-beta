// src/components/content/ContentPage.jsx
// Generic renderer for a document in the `legal` i18n namespace. Selects the
// sub-object by docKey and renders either prose sections[] or FAQ faqItems[].
// `placeholder` shows the non-binding PlaceholderBanner (legal docs only).
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/layout/PageTitle";
import PlaceholderBanner from "@/components/content/PlaceholderBanner";
import ContentSections from "@/components/content/ContentSections";
import FaqList from "@/components/content/FaqList";

const ContentPage = ({ docKey, placeholder = false }) => {
  const { t } = useTranslation("legal");

  const sections = t(`${docKey}.sections`, { returnObjects: true });
  const faqItems = t(`${docKey}.faqItems`, { returnObjects: true });
  const intro = t(`${docKey}.intro`, { defaultValue: "" });

  const hasFaq = Array.isArray(faqItems) && faqItems.length > 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title={t(`${docKey}.pageTitle`)} />
      <div className="px-6 pb-12">
        {placeholder && <PlaceholderBanner />}
        {intro && (
          <p className="mb-8 leading-relaxed text-muted-foreground">{intro}</p>
        )}
        {hasFaq ? (
          <FaqList items={faqItems} />
        ) : (
          <ContentSections sections={Array.isArray(sections) ? sections : []} />
        )}
      </div>
    </div>
  );
};

ContentPage.propTypes = {
  docKey: PropTypes.string.isRequired,
  placeholder: PropTypes.bool,
};

export default ContentPage;
