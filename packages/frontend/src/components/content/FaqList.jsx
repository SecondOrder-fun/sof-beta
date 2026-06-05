// src/components/content/FaqList.jsx
// Renders FAQ question/answer pairs as a collapsible accordion.
import PropTypes from "prop-types";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

const FaqList = ({ items }) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <Accordion type="single" collapsible className="w-full">
      {items.map((item, i) => (
        <AccordionItem key={i} value={`faq-${i}`}>
          <AccordionTrigger className="text-left text-foreground">
            {item?.question}
          </AccordionTrigger>
          <AccordionContent className="leading-relaxed text-muted-foreground">
            {item?.answer}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
};

FaqList.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      question: PropTypes.string,
      answer: PropTypes.string,
    })
  ),
};

export default FaqList;
