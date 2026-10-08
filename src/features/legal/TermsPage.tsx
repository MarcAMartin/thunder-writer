import { Link } from 'react-router-dom'
import { PRIVACY_PATH } from '../home/routes'
import { CONTACT_EMAIL, Ext, LegalPage, LegalSection } from './LegalPage'

/** The Terms of Service (/terms). Update LEGAL_EFFECTIVE_DATE whenever they change. */
export function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p className="lg-lead">
        These terms cover your use of Thunder Writer, a free writing app that runs in your web browser. By using it, you
        agree to them. If you don’t agree, please don’t use Thunder Writer. How your information is handled is explained
        in the <Link to={PRIVACY_PATH}>Privacy Policy</Link>.
      </p>

      <LegalSection id="service" title="The service">
        <p>
          Thunder Writer is provided free of charge. Features may change, pause or end at any time, and there’s no
          guarantee it will always be available or work without interruption.
        </p>
      </LegalSection>

      <LegalSection id="your-writing" title="Your writing is yours">
        <p>
          You own everything you write in Thunder Writer and everything you import into it. Thunder Writer claims no rights
          to your work, and because it has no server, the developer doesn’t have a copy of it.
        </p>
      </LegalSection>

      <LegalSection id="backups" title="Keep your own backups">
        <p>
          Your work is stored in your browser and, if you connect it, in your Google Drive. Browsers can clear their
          storage, devices fail, and software has bugs. Export or back up anything important regularly. The developer
          isn’t responsible for lost or damaged work.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="AI suggestions">
        <ul>
          <li>
            Suggestions use your own Anthropic or OpenAI API key. You’re responsible for that key, for what your provider
            charges you, and for following its terms (
            <Ext href="https://www.anthropic.com/legal/commercial-terms">Anthropic</Ext>,{' '}
            <Ext href="https://openai.com/policies">OpenAI</Ext>).
          </li>
          <li>
            Suggestions are written by AI. They can be wrong, incomplete or unoriginal, and trivia can be inaccurate. Check
            facts, and decide for yourself what goes in your book.
          </li>
          <li>The cost shown in the app is an estimate. Your provider’s bill is the real one.</li>
        </ul>
      </LegalSection>

      <LegalSection id="third-parties" title="Other services">
        <p>
          Google Drive, Anthropic, OpenAI, FormSubmit, Bookshop.org and Venmo are run by other companies under their own
          terms. Thunder Writer connects to them only when you choose to use them, and the developer isn’t responsible for
          them.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="Acceptable use">
        <p>Please don’t use Thunder Writer to:</p>
        <ul>
          <li>break the law or infringe anyone else’s rights;</li>
          <li>attack, overload or interfere with the site or the services it connects to;</li>
          <li>send spam or abuse through the Suggestion form.</li>
        </ul>
      </LegalSection>

      <LegalSection id="support" title="Book picks and tips">
        <p>
          Book picks may be Bookshop.org affiliate links, so the developer may earn a commission on a purchase, at no
          extra cost to you. Tips through Venmo are voluntary gifts. They don’t buy any service, support or features.
        </p>
      </LegalSection>

      <LegalSection id="warranty" title="No warranty">
        <p>
          Thunder Writer is provided “as is” and “as available”, without warranties of any kind, express or implied,
          including warranties of merchantability, fitness for a particular purpose and non-infringement, to the fullest
          extent the law allows.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Limitation of liability">
        <p>
          To the fullest extent the law allows, the developer isn’t liable for any indirect, incidental, special,
          consequential or punitive damages, or for lost work, data, profits or opportunities, arising from your use of
          Thunder Writer. The developer’s total liability for any claim about Thunder Writer is limited to US$50.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to these terms">
        <p>
          If these terms change, the new version will be posted here with a new effective date. Continuing to use Thunder
          Writer after that means you accept the new terms.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
