// src/components/content/ContentSections.jsx
// Renders an ordered list of prose sections ({ heading, body: string[] })
// sourced from the `legal` i18n namespace. A body line beginning with "- "
// is treated as a bullet; consecutive bullet lines group into one list.
import PropTypes from "prop-types";

function renderBody(body, sectionKey) {
  if (!Array.isArray(body)) return null;
  const blocks = [];
  let bullets = [];

  const flushBullets = (key) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul
        key={`${sectionKey}-ul-${key}`}
        className="list-disc space-y-1 pl-6 text-muted-foreground"
      >
        {bullets.map((b, j) => (
          <li key={j}>{b}</li>
        ))}
      </ul>
    );
    bullets = [];
  };

  body.forEach((line, idx) => {
    if (typeof line === "string" && line.startsWith("- ")) {
      bullets.push(line.slice(2));
      return;
    }
    flushBullets(idx);
    blocks.push(
      <p
        key={`${sectionKey}-p-${idx}`}
        className="leading-relaxed text-muted-foreground"
      >
        {line}
      </p>
    );
  });
  flushBullets("end");
  return blocks;
}

const ContentSections = ({ sections }) => {
  if (!Array.isArray(sections) || sections.length === 0) return null;
  return (
    <div className="space-y-8">
      {sections.map((section, i) => (
        <section key={i} className="space-y-3">
          {section?.heading && (
            <h2 className="text-lg font-semibold text-foreground">
              {section.heading}
            </h2>
          )}
          {renderBody(section?.body, `s${i}`)}
        </section>
      ))}
    </div>
  );
};

ContentSections.propTypes = {
  sections: PropTypes.arrayOf(
    PropTypes.shape({
      heading: PropTypes.string,
      body: PropTypes.arrayOf(PropTypes.string),
    })
  ),
};

export default ContentSections;
