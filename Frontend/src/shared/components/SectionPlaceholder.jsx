export default function SectionPlaceholder({ eyebrow, title, copy }) {
  return (
    <section className="section-card section-placeholder" aria-labelledby="section-placeholder-title">
      <div className="section-copy">
        <p className="section-eyebrow">{eyebrow}</p>
        <h1 id="section-placeholder-title">{title}</h1>
        <p>{copy}</p>
      </div>
    </section>
  )
}
