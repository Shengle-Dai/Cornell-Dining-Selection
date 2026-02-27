import { supabase } from '../lib/supabase'

const GoogleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
    <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 2.58 9 3.58z" fill="#EA4335"/>
  </svg>
)

export default function Landing() {
  async function signInWithGoogle() {
    const redirectTo = `${window.location.origin}/auth/callback`
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-5 text-gray-800">
      <div className="max-w-sm w-full text-center">
        <h1 className="font-serif text-2xl font-semibold text-cornell-red tracking-tight mb-4">
          Daily Dining Picks
        </h1>
        <p className="text-gray-500 text-base leading-relaxed mb-8">
          Personalized recommendations for West Campus, powered by food2vec.
        </p>

        <button
          onClick={signInWithGoogle}
          className="flex items-center justify-center gap-2.5 w-full px-4 py-3.5 border border-cornell-red text-cornell-red text-sm font-semibold uppercase tracking-wide rounded hover:bg-cornell-red hover:text-white transition-all"
        >
          <GoogleLogo />
          Sign in with Google
        </button>
        <p className="text-xs text-gray-400 mt-3">Requires a .edu email address.</p>

        <div className="mt-10 font-serif text-xs italic text-gray-400">No spam, just food.</div>
      </div>

      {/* How it works */}
      <div className="mt-16 pt-10 border-t border-gray-100 flex justify-center gap-10 flex-wrap max-w-xl w-full">
        {[
          {
            title: 'Menu Scrape',
            desc: 'Daily menus from West Campus dining halls.',
            icon: (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            ),
          },
          {
            title: 'AI Curates',
            desc: 'Personalized picks via food2vec embeddings.',
            icon: (
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            ),
          },
          {
            title: 'You Eat',
            desc: 'A clean daily email. Rate dishes to improve picks.',
            icon: (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            ),
          },
        ].map(({ title, desc, icon }) => (
          <div key={title} className="flex-1 min-w-[120px] flex flex-col items-center text-center">
            <div className="w-14 h-14 flex items-center justify-center text-cornell-red mb-5">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-8 h-8" strokeWidth={1}>
                {icon}
              </svg>
            </div>
            <h3 className="font-serif text-xs uppercase tracking-widest font-semibold text-gray-800 mb-2">
              {title}
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed max-w-[160px]">{desc}</p>
          </div>
        ))}
      </div>

      {/* Email preview */}
      <div className="mt-16 w-full max-w-md px-5">
        <div className="border border-gray-200 bg-gray-50 p-8 text-left">
          <div className="text-xs text-gray-400 uppercase tracking-wide pb-4 mb-6 border-b border-gray-200 flex justify-between">
            <span>Fri, Feb 13</span>
            <span>Sample Email</span>
          </div>
          <div>
            <h2 className="font-serif text-lg text-cornell-red font-semibold mb-4">Lunch</h2>
            {[
              { rank: '#1', eatery: 'Becker House', dishes: ['Sweet Chili Chicken Drumsticks', 'Tofu & Vegetable Lo Mein'] },
              { rank: '#2', eatery: 'Bethe House', dishes: ['Sweet & Sour Pork', 'Orange Tofu Stir Fry'] },
            ].map(({ rank, eatery, dishes }) => (
              <div key={eatery} className="mb-4">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 mb-1">
                  <span className="text-xs text-cornell-red bg-red-50 px-1.5 py-0.5 rounded">{rank}</span>
                  {eatery}
                </div>
                <ul className="text-xs text-gray-500 space-y-0.5 pl-0 list-none">
                  {dishes.map(d => (
                    <li key={d} className="pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-gray-300">
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
