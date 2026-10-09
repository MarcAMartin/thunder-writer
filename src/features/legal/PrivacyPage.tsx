import { Link } from 'react-router-dom'
import { SETTINGS_PATH, TERMS_PATH } from '../home/routes'
import { CONTACT_EMAIL, Ext, LegalPage, LegalSection } from './LegalPage'

const GOOGLE_USER_DATA_POLICY = 'https://developers.google.com/terms/api-services-user-data-policy'

/**
 * The Privacy Policy (/privacy). Keep it true to the code: if the app starts
 * sending anything new anywhere, say so here and update LEGAL_EFFECTIVE_DATE.
 */
export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p className="lg-lead">
        Thunder Writer is a writing app that runs entirely in your web browser. It has no accounts and no server of its
        own, so the developer never receives your manuscripts, your API keys or anything else about your writing. This
        policy explains what stays on your device, what goes to the services you choose to use, and the little that
        reaches the developer.
      </p>

      <LegalSection id="summary" title="The short version">
        <ul>
          <li>No account, no Thunder Writer server, no analytics, no advertising trackers, and no cookies set by Thunder Writer.</li>
          <li>Your writing is stored in your browser and, if you connect it, in your own Google Drive.</li>
          <li>AI suggestions go straight from your browser to Anthropic, OpenAI or OpenRouter, using your own API key.</li>
          <li>Nothing is sold or shared for advertising. There is nothing to sell: the developer doesn’t have your data.</li>
        </ul>
      </LegalSection>

      <LegalSection id="browser" title="What stays in your browser">
        <p>
          Your manuscripts, their backups, reference files you add, and your settings (including any Claude, OpenAI or OpenRouter
          API key) are saved in this browser’s storage (IndexedDB and localStorage) on your device. They stay there until you
          remove them with <Link to={`${SETTINGS_PATH}#data`}>Settings → Clear all local data</Link> or by clearing this
          site’s data in your browser.
        </p>
        <p>
          Anyone who can use this browser profile, and browser extensions allowed to read this site, may be able to see
          that data. Use a dedicated API key with a spending limit, and avoid shared computers.
        </p>
      </LegalSection>

      <LegalSection id="google-drive" title="Google Drive">
        <p>
          Connecting Google Drive is optional. When you connect it, Thunder Writer asks Google for one permission,{' '}
          <code>drive.file</code>, which lets it see and change only files it created or files you choose to open with it
          (for example, by picking them in Google’s file picker). It cannot see the rest of your Drive.
        </p>
        <ul>
          <li>
            <strong>What it accesses:</strong> the “Thunder Writer” folder it creates in your Drive, the manuscripts and{' '}
            <code>.bak</code> backup files it saves there, and any document you pick to import.
          </li>
          <li>
            <strong>How it’s used:</strong> only to save, open, back up and import your manuscripts when you ask it to, or
            as autosave while you write.
          </li>
          <li>
            <strong>Where it’s kept:</strong> your files stay in your Google Drive, under your Google account. The access
            Google grants is kept in memory for the session and never saved.
          </li>
          <li>
            <strong>Sharing:</strong> data from your Google account is never sent to the developer, never sold, never used
            for advertising, and never used by Thunder Writer to train AI models. If you turn on AI suggestions for a
            manuscript you opened from Drive, its text is sent to the AI provider you chose, as described below, because you
            asked for suggestions on it.
          </li>
        </ul>
        <p>
          Thunder Writer’s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
          <Ext href={GOOGLE_USER_DATA_POLICY}>Google API Services User Data Policy</Ext>, including the Limited Use
          requirements.
        </p>
        <p>
          You can disconnect Thunder Writer at any time in your Google Account under{' '}
          <Ext href="https://myaccount.google.com/connections">Third-party apps &amp; services</Ext>. Files it saved stay
          in your Drive until you delete them.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="AI suggestions (Anthropic, OpenAI and OpenRouter)">
        <p>
          Suggestions only run after you add your own API key. Your browser then sends requests directly to Anthropic (
          <code>api.anthropic.com</code>), OpenAI (<code>api.openai.com</code>) or OpenRouter (<code>openrouter.ai</code>),
          under your own account with them. A request contains your manuscript’s text (for long books, the opening and the
          part around your cursor), reference files you added, and the titles of recent suggestions. Requests never pass
          through the developer.
        </p>
        <p>
          OpenRouter passes each request on to the company that runs the model you chose. Your OpenRouter privacy settings
          control which of those companies it may use, for example to exclude ones that may train on your data. When
          OpenRouter is your provider, Thunder Writer also loads OpenRouter’s public list of models and prices.
        </p>
        <p>
          How the provider handles that data is governed by its API terms and privacy policy:{' '}
          <Ext href="https://www.anthropic.com/legal/privacy">Anthropic</Ext>,{' '}
          <Ext href="https://openai.com/policies/privacy-policy">OpenAI</Ext>,{' '}
          <Ext href="https://openrouter.ai/privacy">OpenRouter</Ext> (and the model’s provider).
        </p>
        <p>
          If web-searched trivia is on, the provider may also run web searches using short queries its model writes about
          topics and places in your manuscript. You can turn this off in <Link to={`${SETTINGS_PATH}#suggestions`}>Settings</Link>.
        </p>
      </LegalSection>

      <LegalSection id="computer" title="Files on your computer">
        <p>
          Opening a file from your computer, or keeping a copy there, uses your browser’s own file access. Thunder Writer
          reads or writes only the files you choose, and only after your browser asks for your permission. Nothing is
          uploaded anywhere.
        </p>
      </LegalSection>

      <LegalSection id="suggestion-form" title="When you send a suggestion">
        <p>
          The Suggestion form sends what you type, plus your email address if you add one, through FormSubmit (
          <code>formsubmit.co</code>), which emails it to the developer. It never includes your manuscript. Your message
          is used only to read your idea and reply to you, is kept in the developer’s email, and is deleted on request.
          FormSubmit’s own privacy policy covers how it handles the message on the way.
        </p>
      </LegalSection>

      <LegalSection id="links" title="Book picks, tips and other sites">
        <p>
          Book picks link to Bookshop.org. Some are affiliate links, so the developer may earn a commission if you buy
          something, at no extra cost to you. The tip jar links to Venmo. Thunder Writer loads nothing from these sites;
          they only learn that you came from Thunder Writer if you click a link, and their own privacy policies apply from
          there.
        </p>
      </LegalSection>

      <LegalSection id="hosting" title="Hosting">
        <p>
          Thunder Writer’s files are served by Vercel. Like any web host, Vercel may record standard request information,
          such as your IP address, browser type and the page requested, to deliver and protect the site, under{' '}
          <Ext href="https://vercel.com/legal/privacy-policy">Vercel’s privacy policy</Ext>. Thunder Writer adds no
          analytics or tracking of its own.
        </p>
      </LegalSection>

      <LegalSection id="children" title="Children">
        <p>
          Thunder Writer isn’t directed to children under 13. If a child has sent a suggestion that includes their email
          address, contact the developer and it will be deleted.
        </p>
      </LegalSection>

      <LegalSection id="choices" title="Your choices">
        <ul>
          <li>Delete everything Thunder Writer stored in this browser with Settings → Clear all local data.</li>
          <li>Remove an API key in Settings, and revoke it with your AI provider if in doubt.</li>
          <li>Disconnect Google Drive in your Google Account, and delete the files Thunder Writer saved in your Drive.</li>
          <li>
            Ask the developer to see or delete any suggestion you sent, by writing to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this policy">
        <p>
          If this policy changes, the new version will be posted here with a new effective date. Using Thunder Writer is
          also subject to the <Link to={TERMS_PATH}>Terms of Service</Link>.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about privacy: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
