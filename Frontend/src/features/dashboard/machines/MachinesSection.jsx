import SectionPlaceholder from '../../../shared/components/SectionPlaceholder.jsx'
import { placeholderSections } from '../../../shared/data/dashboardMock.js'

export default function MachinesSection() {
  return <SectionPlaceholder {...placeholderSections.machines} />
}
