"""
Phishing Protection Simulation Game
A web-based educational game to teach users how to identify phishing attacks
"""

from flask import Flask, render_template, request, redirect, url_for, session, jsonify, g, abort
import psycopg
from psycopg.rows import dict_row
import os
import json
import random
import secrets
import string
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY') or os.environ.get('FLASK_SECRET_KEY') or 'dev-insecure-change-me'

def _db_url():
    url = (
        os.environ.get('DATABASE_URL')
        or os.environ.get('POSTGRES_URL')
        or os.environ.get('POSTGRES_PRISMA_URL')
    )
    if not url:
        raise RuntimeError(
            'No Postgres connection string found. Set DATABASE_URL (or POSTGRES_URL) '
            'to your Neon / Vercel Postgres connection string.'
        )
    return url

# ============== PvP CONSTANTS ==============

# Effect registry: enum id -> (cooldown_seconds, allowed_stages|None, label, description)
ATTACK_EFFECTS = {
    'lottery_popup':      {'cooldown': 25, 'stages': {'dashboard'}, 'label': 'Lottery scam',       'desc': 'Fake $1M prize popup. Only works while defender is on the dashboard.'},
    'verify_popup':       {'cooldown': 25, 'stages': {'dashboard'}, 'label': 'Verification scam',  'desc': 'Fake SSN/card verification popup. Dashboard only.'},
    'fake_2fa':           {'cooldown': 30, 'stages': {'dashboard'}, 'label': 'Fake 2FA prompt',    'desc': 'Fake authenticator popup asks for phone number and code. Dashboard only.'},
    'distraction_banner': {'cooldown': 15, 'stages': None,          'label': 'Urgent banner',       'desc': 'Red banner across the top of the defender window. Any stage.'},
    'session_timeout':    {'cooldown': 30, 'stages': None,          'label': 'Session timeout',     'desc': 'Fake "session expiring" popup that asks for password. Any stage.'},
    'screen_glitch':      {'cooldown': 12, 'stages': None,          'label': 'Screen glitch',       'desc': 'Brief visual distortion — screen shakes and flickers. Any stage.'},
    'fake_email':         {'cooldown': 45, 'stages': {'email'},     'label': 'Inject email',        'desc': 'Slip a convincing phishing email into the inbox. Only while defender reads mail.'},
    'url_spoof':          {'cooldown': 20, 'stages': {'browser'},   'label': 'URL bar spoof',       'desc': 'Flash a typosquatted URL in the address bar. Only on the browser page.'},
    'grandma_text':       {'cooldown': 35, 'stages': {'transfer'},  'label': 'Fake text from Grandma', 'desc': 'A fake text from "Grandma" asking to send money to a different account. Transfer page only.'},
}

# ============== DATABASE HELPERS ==============

def _translate(sql):
    """Translate sqlite ? placeholders to psycopg %s. Safe because no query uses literal ? or %."""
    return sql.replace('?', '%s')

def get_db():
    """Get a request-scoped Postgres connection."""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = psycopg.connect(
            _db_url(),
            row_factory=dict_row,
            autocommit=True,
            connect_timeout=10,
        )
    return db

@app.teardown_appcontext
def close_connection(exception):
    """Close database connection"""
    db = getattr(g, '_database', None)
    if db is not None:
        try:
            db.close()
        except Exception:
            pass


def query_db(query, args=(), one=False):
    """Query database helper"""
    cur = get_db().cursor()
    cur.execute(_translate(query), args)
    rv = cur.fetchall()
    cur.close()
    return (rv[0] if rv else None) if one else rv

def execute_db(query, args=()):
    """Execute an INSERT/UPDATE/DELETE. For INSERT ... RETURNING id, returns the new id."""
    cur = get_db().cursor()
    cur.execute(_translate(query), args)
    result = None
    if cur.description:
        try:
            row = cur.fetchone()
            if row and 'id' in row:
                result = row['id']
        except psycopg.ProgrammingError:
            pass
    cur.close()
    return result

# ============== SESSION MANAGEMENT ==============

def init_game_session():
    """Initialize a new game session"""
    if 'user_id' not in session:
        # Create anonymous user
        user_id = execute_db('INSERT INTO users (username) VALUES (?) RETURNING id', ('anonymous_' + str(datetime.now().timestamp()),))
        session['user_id'] = user_id
    
    # Create new game session
    session_id = execute_db(
        'INSERT INTO sessions (user_id, stage, score, actions_json, start_time) VALUES (?, ?, ?, ?, ?) RETURNING id',
        (session['user_id'], 'start', 100, '[]', datetime.now().isoformat())
    )
    session['session_id'] = session_id
    session['stage'] = 'start'
    session['score'] = 100
    session['actions'] = []
    session['password_set'] = False
    session['logged_in'] = False
    session['weak_password_used'] = False

def log_action(action, outcome, score_change=0):
    """Log user action to database"""
    if 'session_id' not in session:
        return
    
    execute_db(
        'INSERT INTO logs (session_id, timestamp, action, outcome, score_change) VALUES (?, ?, ?, ?, ?)',
        (session['session_id'], datetime.now().isoformat(), action, outcome, score_change)
    )
    
    # Update session score
    if score_change != 0:
        session['score'] = session.get('score', 100) + score_change
        execute_db(
            'UPDATE sessions SET score = ? WHERE id = ?',
            (session['score'], session['session_id'])
        )
    
    # Track action
    actions = session.get('actions', [])
    actions.append({'action': action, 'outcome': outcome, 'score_change': score_change})
    session['actions'] = actions

def update_stage(stage):
    """Update current stage"""
    session['stage'] = stage
    if 'session_id' in session:
        execute_db('UPDATE sessions SET stage = ? WHERE id = ?', (stage, session['session_id']))
    # Mirror into match row so attacker polling can see coarse defender state
    mid = session.get('match_id')
    if mid and session.get('match_role') == 'defender':
        execute_db("UPDATE matches SET defender_stage = ? WHERE id = ? AND status = 'active'", (stage, mid))

# ============== PvP HELPERS ==============

ROOM_ALPHABET = ''.join(c for c in (string.ascii_uppercase + string.digits) if c not in 'O0I1L')

def generate_room_code():
    for _ in range(10):
        code = ''.join(secrets.choice(ROOM_ALPHABET) for _ in range(6))
        if not query_db('SELECT 1 FROM matches WHERE room_code = ?', (code,), one=True):
            return code
    raise RuntimeError('Could not generate unique room code')

def get_match(code):
    return query_db('SELECT * FROM matches WHERE room_code = ?', (code,), one=True)

def require_role(code, role):
    """Return the match row if session holds a valid role token for this match, else None."""
    m = get_match(code)
    if not m:
        return None
    tok_key = f'match:{code}:token'
    role_key = f'match:{code}:role'
    if session.get(role_key) != role:
        return None
    expected = m['defender_token'] if role == 'defender' else m['attacker_token']
    if not expected or session.get(tok_key) != expected:
        return None
    return m

def issue_role(code, role, match_row):
    """Persist a freshly-generated role token and mirror into session."""
    tok = secrets.token_urlsafe(24)
    col = 'defender_token' if role == 'defender' else 'attacker_token'
    execute_db(f'UPDATE matches SET {col} = ? WHERE id = ?', (tok, match_row['id']))
    session[f'match:{code}:token'] = tok
    session[f'match:{code}:role'] = role
    session['match_id'] = match_row['id']
    session['match_code'] = code
    session['match_role'] = role

def clear_match_session(code):
    for k in (f'match:{code}:token', f'match:{code}:role'):
        session.pop(k, None)
    session.pop('match_id', None)
    session.pop('match_code', None)
    session.pop('match_role', None)

def finish_match(match_id, winner, reason=None):
    """Mark a match finished. Safe to call multiple times — only the first write lands."""
    execute_db(
        "UPDATE matches SET status = 'finished', winner = ?, loss_reason = ?, ended_at = ? "
        "WHERE id = ? AND status != 'finished'",
        (winner, reason, datetime.now().isoformat(), match_id)
    )

def in_pvp_defender():
    return bool(session.get('match_id') and session.get('match_role') == 'defender')

# ============== CONTEXT PROCESSOR ==============

@app.context_processor
def inject_game_state():
    return {
        'game_score': session.get('score', 100),
        'match_role': session.get('match_role'),
        'match_code': session.get('match_code'),
    }

# ============== ROUTES ==============

@app.route('/')
def start():
    """Landing page with narrative modal"""
    # Only init new session if none exists or game was completed
    if 'session_id' not in session or session.get('stage') in ['completed', None]:
        init_game_session()
    
    # Check if game already started (skip modal)
    game_started = session.get('game_started', False)
    return render_template('start.html', game_started=game_started)

@app.route('/new')
def new_game():
    """Start a fresh game"""
    session.clear()
    init_game_session()
    return redirect(url_for('start'))

@app.route('/start_game', methods=['POST'])
def start_game_action():
    """Mark game as started"""
    session['game_started'] = True
    return jsonify({'status': 'ok'})

@app.route('/debrief')
def debrief():
    """Cinematic scroll-driven storytelling debrief of the phishing simulation."""
    return render_template('debrief.html')

@app.route('/credits')
def credits():
    """Team credits page"""
    team = [
        {
            'name': 'Jahangir Huseynov',
            'role': 'Lead Designer',
            'contribution': 'Visual design, UI/UX direction, layout systems, color schemes, responsive design',
            'percent': 25
        },
        {
            'name': 'Mark Crawford',
            'role': 'Scrum Master',
            'contribution': 'Team coordination, sprint planning, meeting facilitation, project management',
            'percent': 25
        },
        {
            'name': 'Fallon Ough',
            'role': 'Senior Developer',
            'contribution': 'Backend architecture, Flask routing, database design, game logic, PvP system',
            'percent': 25
        },
        {
            'name': 'Elijah Gould',
            'role': 'Senior Developer',
            'contribution': 'Frontend templates, JavaScript interactions, API endpoints, session management',
            'percent': 25
        }
    ]
    return render_template('credits.html', team=team)

@app.route('/email')
def email():
    """Email inbox with phishing and legit emails"""
    if 'session_id' not in session:
        return redirect(url_for('start'))
    
    update_stage('email')
    log_action('visited_email', 'navigated to email inbox')
    
    emails = [
        {
            'id': 1,
            'sender': 'Bank of Secure Support',
            'email': 'support@bankofsecure.com',
            'subject': 'Password Reset Instructions',
            'date': 'Jan 20, 2026',
            'snippet': 'Dear Simon, reset your password here using our secure link.',
            'link': '/reset',
            'link_preview': 'https://www.bankofsecure.com/reset',
            'is_phishing': False
        },
        {
            'id': 2,
            'sender': 'Bank of Secure Alerts',
            'email': 'support@bankofsecuure.com',
            'subject': 'ACT NOW: Account Access Issue!',
            'date': 'Jan 20, 2026',
            'snippet': 'Dear Customer, Your account has been compromised! Click immediately!',
            'link': '/lose?reason=email_phish_typo',
            'link_preview': 'http://bankofsecvre.com/reset',
            'is_phishing': True
        },
        {
            'id': 3,
            'sender': 'Security Team',
            'email': 'alerts@bank-secure.com',
            'subject': 'Security Alert - Verify Now',
            'date': 'Jan 19, 2026',
            'snippet': 'Dear Valued Customer, suspicious login detected. Verify identity.',
            'link': '/lose?reason=email_phish_lookalike',
            'link_preview': 'http://bank-secure.com/verify',
            'is_phishing': True
        },
        {
            'id': 4,
            'sender': 'Bank of Secure',
            'email': 'bankofsecure@gmail.com',
            'subject': 'Simon, Immediate Assistance Required',
            'date': 'Jan 19, 2026',
            'snippet': 'Dear Simon Benson, we need you to verify your information.',
            'link': '/lose?reason=email_phish_gmail',
            'link_preview': 'http://bankofsecure-verify.com/form',
            'is_phishing': True
        },
        {
            'id': 5,
            'sender': 'BankofSecure Support',
            'email': 'noreply@bank0fsecure.com',
            'subject': 'Your Account Has Been Limited',
            'date': 'Jan 18, 2026',
            'snippet': 'We have limited your account. Click here to restore access.',
            'link': '/lose?reason=email_phish_zero',
            'link_preview': 'http://bank0fsecure.com/restore',
            'is_phishing': True
        },
        {
            'id': 6,
            'sender': 'Online Banking',
            'email': 'secure@bankofsecure.net',
            'subject': 'Confirm Your Recent Transaction',
            'date': 'Jan 18, 2026',
            'snippet': 'A transaction of $999.99 was made. Click to dispute.',
            'link': '/lose?reason=email_phish_net',
            'link_preview': 'http://bankofsecure.net/dispute',
            'is_phishing': True
        },
        {
            'id': 7,
            'sender': 'Account Services',
            'email': 'services@bankoofsecure.com',
            'subject': 'Password Reset Request for Simon Benson',
            'date': 'Jan 17, 2026',
            'snippet': 'Hi Simon, we received a password reset request for your account. Click to reset.',
            'link': '/lose?reason=email_phish_double_o',
            'link_preview': 'http://bankoofsecure.com/reset',
            'is_phishing': True
        },
        {
            'id': 8,
            'sender': 'Fraud Prevention',
            'email': 'fraud@bankofsecure.co',
            'subject': 'Unusual Activity Detected',
            'date': 'Jan 17, 2026',
            'snippet': 'Dear Simon, we detected unusual activity. Verify your identity immediately.',
            'link': '/lose?reason=email_phish_co',
            'link_preview': 'http://bankofsecure.co/verify',
            'is_phishing': True
        },
        {
            'id': 9,
            'sender': 'Customer Support',
            'email': 'help@bank-of-secure.com',
            'subject': 'Password Reset Confirmation',
            'date': 'Jan 16, 2026',
            'snippet': 'Simon Benson, your password was recently changed. If this wasn\'t you, click here.',
            'link': '/lose?reason=email_phish_hyphen',
            'link_preview': 'http://bank-of-secure.com/reset-confirm',
            'is_phishing': True
        },
        {
            'id': 10,
            'sender': 'BankOfSecure',
            'email': 'admin@bankofsecure.org',
            'subject': 'Free Account Upgrade Available',
            'date': 'Jan 15, 2026',
            'snippet': 'Congratulations Simon! You qualify for a free premium upgrade.',
            'link': '/lose?reason=email_phish_org',
            'link_preview': 'http://bankofsecure.org/upgrade',
            'is_phishing': True
        }
    ]

    random.shuffle(emails)
    return render_template('email.html', emails=emails)

@app.route('/reset', methods=['GET', 'POST'])
def reset():
    """Password reset page"""
    if 'session_id' not in session:
        return redirect(url_for('start'))
    
    update_stage('reset')
    
    if request.method == 'POST':
        password = request.form.get('password', '')
        confirm = request.form.get('confirm', '')
        
        if password != confirm:
            return render_template('reset.html', error='Passwords do not match')
        
        # Check password strength
        strength = check_password_strength(password)
        
        if strength == 'weak':
            log_action('weak_password', 'used weak password', -15)
            session['weak_password_used'] = True
        elif strength == 'medium':
            log_action('medium_password', 'used medium strength password', -5)
        else:
            log_action('strong_password', 'used strong password', 0)
        
        session['password_set'] = True
        log_action('password_reset', 'completed password reset')
        return redirect(url_for('browser', prompt='login'))
    
    log_action('visited_reset', 'navigated to password reset')
    return render_template('reset.html')

def check_password_strength(password):
    """Check password strength and return level"""
    has_upper = any(c.isupper() for c in password)
    has_lower = any(c.islower() for c in password)
    has_digit = any(c.isdigit() for c in password)
    has_special = any(c in '!@#$%^&*()_+-=[]{}|;:,.<>?' for c in password)
    
    length = len(password)
    variety = sum([has_upper, has_lower, has_digit, has_special])
    
    if length < 8 or variety < 2:
        return 'weak'
    elif length < 12 or variety < 3:
        return 'medium'
    else:
        return 'strong'

@app.route('/browser')
def browser():
    """Browser simulation with address bar"""
    if 'session_id' not in session:
        return redirect(url_for('start'))
    
    update_stage('browser')
    prompt = request.args.get('prompt', '')
    log_action('visited_browser', f'opened browser, prompt: {prompt}')
    
    return render_template('browser.html', prompt=prompt)

@app.route('/site')
def site():
    """Handle URL navigation in simulated browser"""
    if 'session_id' not in session:
        return redirect(url_for('start'))
    
    url = request.args.get('url', '').lower().strip()
    log_action('navigated_url', f'entered URL: {url}')
    
    # Check for correct URL
    correct_urls = [
        'https://www.bankofsecure.com',
        'https://bankofsecure.com',
        'www.bankofsecure.com',
        'bankofsecure.com'
    ]
    
    # Normalize URL for comparison
    normalized = url.replace('https://', '').replace('http://', '').rstrip('/')
    
    if normalized in ['www.bankofsecure.com', 'bankofsecure.com']:
        if url.startswith('https://') or not url.startswith('http://'):
            return render_template('login.html', is_real=True, page_stage='login')
    
    # Check for phishing URLs
    phishing_indicators = [
        'bankofsecrue', 'bankofsecuure', 'bank-secure', 'bank0fsecure',
        'bankofsecure.net', 'bankofsecure.org', 'bankofsecure.co',
        'bankoofsecure', 'bank-of-secure', 'bankofsecvre'
    ]
    
    for indicator in phishing_indicators:
        if indicator in url:
            log_action('visited_phishing_site', f'navigated to phishing URL: {url}', -10)
            return render_template('fake_login.html', url=url, page_stage='fake_login')
    
    # Unknown URL - show error
    return render_template('browser.html', prompt='login', error='Page not found. Try https://www.bankofsecure.com')

@app.route('/login', methods=['POST'])
def login():
    """Handle login form submission"""
    if 'session_id' not in session:
        return redirect(url_for('start'))
    
    is_real = request.form.get('is_real', 'false') == 'true'
    
    if is_real:
        session['logged_in'] = True
        log_action('successful_login', 'logged into real bank site')
        update_stage('dashboard')
        return redirect(url_for('dashboard'))
    else:
        log_action('phishing_login', 'submitted credentials to phishing site', -25)
        return redirect(url_for('lose', reason='fake_login'))

@app.route('/dashboard')
def dashboard():
    """Bank dashboard with attack popups"""
    if 'session_id' not in session:
        return redirect(url_for('start'))
    
    if not session.get('logged_in'):
        return redirect(url_for('browser', prompt='login'))
    
    update_stage('dashboard')
    log_action('visited_dashboard', 'viewing bank dashboard')

    return render_template('dashboard.html', balance=1000, pvp_defender=in_pvp_defender())

@app.route('/attack_clicked')
def attack_clicked():
    """Handle clicking on attack popups"""
    attack_type = request.args.get('type', 'unknown')
    
    if attack_type == 'lottery':
        log_action('clicked_lottery_scam', 'fell for lottery scam popup', -30)
        return redirect(url_for('lose', reason='lottery_scam'))
    elif attack_type == 'verify':
        log_action('clicked_verify_scam', 'submitted info to fake verification', -30)
        return redirect(url_for('lose', reason='verify_scam'))
    elif attack_type == 'session_timeout':
        log_action('clicked_session_timeout', 'entered password into fake timeout prompt', -30)
        return redirect(url_for('lose', reason='session_timeout_scam'))
    elif attack_type == 'fake_2fa':
        log_action('clicked_fake_2fa', 'submitted phone/code to fake 2FA prompt', -30)
        return redirect(url_for('lose', reason='fake_2fa_scam'))
    elif attack_type == 'injected_email':
        log_action('clicked_injected_email', 'clicked link in attacker-injected phishing email', -30)
        return redirect(url_for('lose', reason='injected_email'))
    elif attack_type == 'grandma_text':
        log_action('clicked_grandma_text', 'followed fake text from impersonated Grandma', -30)
        return redirect(url_for('lose', reason='grandma_text_scam'))

    return redirect(url_for('dashboard'))

@app.route('/popup_closed')
def popup_closed():
    """Log when user correctly closes popup"""
    popup_type = request.args.get('type', 'unknown')
    log_action(f'closed_{popup_type}_popup', 'correctly ignored malicious popup', 5)
    return jsonify({'status': 'ok'})

@app.route('/transfer', methods=['GET', 'POST'])
def transfer():
    """Transfer funds page"""
    if 'session_id' not in session:
        return redirect(url_for('start'))
    
    if not session.get('logged_in'):
        return redirect(url_for('browser', prompt='login'))
    
    update_stage('transfer')
    
    if request.method == 'POST':
        amount = request.form.get('amount', '')
        
        try:
            amount = float(amount)
            if amount == 500:
                log_action('successful_transfer', 'completed transfer to Grandma')
                return redirect(url_for('win'))
            else:
                return render_template('transfer.html', error='Amount must be exactly $500')
        except ValueError:
            return render_template('transfer.html', error='Invalid amount')
    
    log_action('visited_transfer', 'viewing transfer page')
    return render_template('transfer.html')

@app.route('/lose')
def lose():
    """Lose page with debrief"""
    reason = request.args.get('reason', 'unknown')
    
    # Get explanation based on reason
    explanations = {
        'email_phish_typo': {
            'title': 'Phishing Email - Typo Domain',
            'details': 'The email came from "support@bankofsecuure.com" (note the double "u"). Legitimate banks always use their exact official domain.',
            'red_flags': [
                'Domain had a typo: "bankofsecuure.com" instead of "bankofsecure.com"',
                'Urgent language: "ACT NOW"',
                'Generic greeting: "Dear Customer" instead of your name',
                'Link preview showed HTTP (not HTTPS)'
            ]
        },
        'email_phish_lookalike': {
            'title': 'Phishing Email - Look-alike Domain',
            'details': 'The email came from "alerts@bank-secure.com" which looks similar but is NOT the same as "bankofsecure.com".',
            'red_flags': [
                'Domain looks similar but different: "bank-secure.com"',
                'Creates urgency with security threats',
                'Asks you to verify identity through email link'
            ]
        },
        'email_phish_gmail': {
            'title': 'Phishing Email - Gmail Domain',
            'details': 'Legitimate banks NEVER use free email services like Gmail, Yahoo, or Hotmail.',
            'red_flags': [
                'Email from Gmail: "bankofsecure@gmail.com"',
                'Banks have their own email domains',
                'Vague request for "assistance"'
            ]
        },
        'email_phish_zero': {
            'title': 'Phishing Email - Number Substitution',
            'details': 'The domain "bank0fsecure.com" uses a zero (0) instead of the letter "o".',
            'red_flags': [
                'Character substitution: "0" instead of "o"',
                'Threatening language about limited account',
                'Urgency to click and restore access'
            ]
        },
        'email_phish_net': {
            'title': 'Phishing Email - Wrong TLD',
            'details': 'The domain "bankofsecure.net" uses .net instead of .com - a different website entirely.',
            'red_flags': [
                'Wrong top-level domain: .net instead of .com',
                'Fake transaction alert to create panic',
                'Urges immediate action'
            ]
        },
        'email_phish_double_o': {
            'title': 'Phishing Email - Extra Character',
            'details': 'The domain "bankoofsecure.com" has an extra "o" making it a fake domain.',
            'red_flags': [
                'Extra character in domain: "bankoofsecure"',
                'False urgency about password expiring'
            ]
        },
        'email_phish_co': {
            'title': 'Phishing Email - .co Domain',
            'details': 'The domain "bankofsecure.co" uses .co instead of .com - often used by scammers.',
            'red_flags': [
                'Wrong TLD: .co instead of .com',
                '.co domains are often used for phishing',
                'Claims of unusual activity'
            ]
        },
        'email_phish_hyphen': {
            'title': 'Phishing Email - Hyphenated Domain',
            'details': 'The domain "bank-of-secure.com" adds hyphens - not the official domain.',
            'red_flags': [
                'Hyphens added to domain name',
                'Request to update payment information'
            ]
        },
        'email_phish_org': {
            'title': 'Phishing Email - .org Domain',
            'details': 'The domain "bankofsecure.org" uses .org - banks use .com for commercial sites.',
            'red_flags': [
                'Wrong TLD: .org instead of .com',
                'Too-good-to-be-true offer (free upgrade)',
                'Banks don\'t offer "free upgrades" via email'
            ]
        },
        'fake_login': {
            'title': 'Phishing Website - Fake Login',
            'details': 'You entered your credentials on a fake website that mimics the real bank.',
            'red_flags': [
                'URL was not the official bank domain',
                'Missing or invalid HTTPS certificate',
                'Subtle visual differences from real site',
                'Always verify the URL before entering credentials'
            ]
        },
        'lottery_scam': {
            'title': 'Social Engineering - Lottery Scam',
            'details': 'This classic scam promises money but asks for a fee. Legitimate lotteries never ask winners to pay fees.',
            'red_flags': [
                'Unsolicited prize notification',
                'Request to send money to receive money',
                'Banks don\'t display lottery popups',
                'If you didn\'t enter, you can\'t win'
            ]
        },
        'verify_scam': {
            'title': 'Social Engineering - Fake Verification',
            'details': 'Scammers create fake security alerts to steal sensitive information like SSN or card numbers.',
            'red_flags': [
                'Banks never ask for full SSN via popup',
                'Legitimate banks use secure, separate verification',
                'Creating artificial urgency',
                'Requesting sensitive data in popup form'
            ]
        },
        'banner_scam': {
            'title': 'Social Engineering - Fake Security Banner',
            'details': 'A fake urgent banner claimed your account was compromised and urged you to click immediately. Real banks never display urgent warnings as website banners asking you to click.',
            'red_flags': [
                'Urgent language designed to cause panic',
                'Vague threat: "unauthorized login attempt" with no details',
                'Asking you to click a link to "secure" your account',
                'Legitimate security alerts come via email or in-app notifications, not browser banners',
                'Real alerts provide specifics (time, location) — this one gave none'
            ]
        },
        'session_timeout_scam': {
            'title': 'Social Engineering - Fake Session Timeout',
            'details': 'A fake popup warned your session was expiring and asked you to re-enter your password. Real session timeouts redirect you to the login page — they never ask for your password inside a popup.',
            'red_flags': [
                'Countdown timer creating artificial urgency',
                'Password field inside a popup overlay, not the real login page',
                'Banks handle expired sessions with a redirect, not a popup',
                'The popup appeared unprompted while you were actively using the site'
            ]
        },
        'fake_2fa_scam': {
            'title': 'Social Engineering - Fake Two-Factor Authentication',
            'details': 'A fake 2FA prompt asked for your phone number and a verification code. Real 2FA is initiated by YOU during login, not by the bank mid-session via a popup.',
            'red_flags': [
                'Unsolicited 2FA request while already logged in',
                'Asking for phone number — your bank already has it on file',
                'Real 2FA sends YOU a code; it never asks you to provide one unprompted',
                'Popup appeared mid-session, not during login'
            ]
        },
        'injected_email': {
            'title': 'Phishing Email - Injected Message',
            'details': 'An attacker slipped a convincing phishing email into your inbox. It looked official but the sender domain was slightly wrong.',
            'red_flags': [
                'Email appeared suddenly while you were browsing your inbox',
                'Sender domain had a subtle typo: "bankofsecure-alert.com"',
                'Urgent subject line pressuring immediate action',
                'Link destination did not match the real bank domain'
            ]
        },
        'grandma_text_scam': {
            'title': 'Social Engineering - Impersonation via Text',
            'details': 'A fake text message pretended to be from Grandma, asking you to send money to a different account. Attackers commonly impersonate family members to redirect transfers.',
            'red_flags': [
                'Unsolicited text appearing during a bank transaction',
                'Requested a different account number than the one already on file',
                'Created urgency: "emergency" or "changed my account"',
                'Real family members wouldn\'t change payment details via a popup during your session',
                'Always verify account changes by contacting the person directly through a known channel'
            ]
        }
    }
    
    explanation = explanations.get(reason, {
        'title': 'Phishing Attack',
        'details': 'You fell for a phishing attack. Always verify sources before clicking links or entering information.',
        'red_flags': ['Unknown attack type']
    })
    
    # Get final score
    final_score = session.get('score', 0)
    actions = session.get('actions', [])
    
    log_action('game_lost', f'lost game: {reason}')

    # Couple to multiplayer match (if any)
    mid = session.get('match_id')
    if mid and session.get('match_role') == 'defender':
        finish_match(mid, 'attacker', reason)

    return render_template('lose.html',
                         explanation=explanation,
                         reason=reason,
                         score=final_score,
                         actions=actions)

@app.route('/win')
def win():
    """Win page with summary"""
    if 'session_id' not in session:
        return redirect(url_for('start'))
    
    final_score = session.get('score', 0)
    actions = session.get('actions', [])
    
    log_action('game_won', 'successfully completed transfer')

    # Update session as completed
    if 'session_id' in session:
        execute_db(
            'UPDATE sessions SET stage = ?, score = ?, end_time = ? WHERE id = ?',
            ('completed', final_score, datetime.now().isoformat(), session['session_id'])
        )

    # Couple to multiplayer match (if any)
    mid = session.get('match_id')
    if mid and session.get('match_role') == 'defender':
        finish_match(mid, 'defender', None)

    return render_template('win.html', score=final_score, actions=actions)

@app.route('/api/log_hover', methods=['POST'])
def log_hover():
    """Log when user hovers over phishing link"""
    data = request.get_json()
    email_id = data.get('email_id', 'unknown')
    is_phishing = data.get('is_phishing', False)
    
    if is_phishing:
        log_action(f'hovered_phishing_email_{email_id}', 'hovered over phishing email', 0)
    
    return jsonify({'status': 'ok'})

@app.route('/api/delete_email', methods=['POST'])
def delete_email():
    """Handle deleting an email from the inbox"""
    data = request.get_json()
    email_id = data.get('email_id', 'unknown')
    is_phishing = data.get('is_phishing', False)
    if is_phishing:
        log_action(f'deleted_phishing_email_{email_id}', 'correctly deleted a phishing email', 5)
    else:
        log_action(f'deleted_legit_email_{email_id}', 'accidentally deleted a legitimate email', -10)
    return jsonify({'status': 'ok'})

@app.route('/api/time_warning', methods=['POST'])
def time_warning():
    """Log time warning"""
    log_action('time_warning', 'timer below 2 minutes', 0)
    return jsonify({'status': 'ok'})

# ============== INITIALIZATION ==============

_INIT_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        stage TEXT DEFAULT 'start',
        score INTEGER DEFAULT 100,
        actions_json TEXT DEFAULT '[]',
        start_time TEXT,
        end_time TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        session_id INTEGER,
        timestamp TEXT,
        action TEXT,
        outcome TEXT,
        score_change INTEGER DEFAULT 0
    )""",
    """CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        room_code TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        defender_token TEXT,
        attacker_token TEXT,
        defender_stage TEXT,
        winner TEXT,
        loss_reason TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_matches_room ON matches(room_code)",
    """CREATE TABLE IF NOT EXISTS match_effects (
        id SERIAL PRIMARY KEY,
        match_id INTEGER NOT NULL REFERENCES matches(id),
        effect_type TEXT NOT NULL,
        payload TEXT,
        consumed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_effects_match ON match_effects(match_id, consumed)",
    """CREATE TABLE IF NOT EXISTS match_cooldowns (
        match_id INTEGER NOT NULL,
        effect_type TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        PRIMARY KEY (match_id, effect_type)
    )""",
]

_db_initialized = False

def init_db():
    """Create tables if they don't exist. Idempotent."""
    global _db_initialized
    with psycopg.connect(_db_url(), autocommit=True, connect_timeout=10) as conn:
        with conn.cursor() as cur:
            for stmt in _INIT_STATEMENTS:
                cur.execute(stmt)
    _db_initialized = True

@app.before_request
def _ensure_db_init():
    global _db_initialized
    if _db_initialized:
        return
    if request.path == '/_health':
        return
    init_db()

@app.route('/_health')
def _health():
    import traceback
    env_present = {k: bool(os.environ.get(k)) for k in (
        'DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL',
        'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING',
        'SECRET_KEY', 'FLASK_SECRET_KEY',
    )}
    try:
        url = _db_url()
    except Exception as e:
        return jsonify({'ok': False, 'stage': 'env', 'env_present': env_present, 'error': str(e)}), 500
    host = 'unknown'
    try:
        host = url.split('@', 1)[1].split('/', 1)[0].split(':')[0]
    except Exception:
        pass
    try:
        with psycopg.connect(url, autocommit=True, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT 1')
                row = cur.fetchone()
        return jsonify({
            'ok': True,
            'stage': 'connected',
            'env_present': env_present,
            'db_host': host,
            'db_initialized_flag': _db_initialized,
            'select_1': row[0] if row else None,
        })
    except Exception as e:
        return jsonify({
            'ok': False,
            'stage': 'connect',
            'env_present': env_present,
            'db_host': host,
            'error_type': type(e).__name__,
            'error': str(e),
            'trace_tail': traceback.format_exc().splitlines()[-15:],
        }), 500

# ============== PvP ROUTES ==============

@app.route('/pvp')
def pvp_landing():
    return render_template('pvp_landing.html')

@app.route('/pvp/create', methods=['POST'])
def pvp_create():
    role = request.form.get('role', 'defender')
    if role not in ('defender', 'attacker'):
        return redirect(url_for('pvp_landing'))
    code = generate_room_code()
    execute_db(
        'INSERT INTO matches (room_code, status, created_at) VALUES (?, ?, ?)',
        (code, 'waiting', datetime.now().isoformat())
    )
    m = get_match(code)
    # Reset any prior match binding the user had
    for k in list(session.keys()):
        if k.startswith('match:'):
            session.pop(k, None)
    issue_role(code, role, m)
    # If joining as defender, spin up a fresh game session bound to this match
    if role == 'defender':
        _reset_defender_game()
    return redirect(url_for('pvp_lobby', code=code))

@app.route('/pvp/join', methods=['POST'])
def pvp_join():
    code = (request.form.get('code') or '').strip().upper()
    if not code:
        return redirect(url_for('pvp_landing'))
    m = get_match(code)
    if not m:
        return render_template('pvp_landing.html', error=f'Room {code} not found.')
    if m['status'] == 'finished':
        return render_template('pvp_landing.html', error=f'Room {code} has already finished.')
    # Decide which role this joiner gets: the one NOT yet bound
    taken = []
    if m['defender_token']: taken.append('defender')
    if m['attacker_token']: taken.append('attacker')
    available = [r for r in ('defender', 'attacker') if r not in taken]
    if not available:
        return render_template('pvp_landing.html', error=f'Room {code} is full.')
    role = available[0]
    issue_role(code, role, m)
    if role == 'defender':
        _reset_defender_game()
    return redirect(url_for('pvp_lobby', code=code))

def _reset_defender_game():
    """Clear single-player session state so the defender starts fresh inside the match."""
    for k in ('user_id', 'session_id', 'stage', 'score', 'actions',
              'password_set', 'logged_in', 'weak_password_used', 'game_started'):
        session.pop(k, None)
    init_game_session()

@app.route('/pvp/room/<code>')
def pvp_lobby(code):
    code = code.upper()
    m = get_match(code)
    if not m:
        return redirect(url_for('pvp_landing'))
    # Must be a participant
    role = session.get(f'match:{code}:role')
    if not role or not require_role(code, role):
        return render_template('pvp_landing.html', error='You are not a participant in that room.')
    # If match is active: send each player to their app
    if m['status'] == 'active':
        return redirect(url_for('attacker_console', code=code) if role == 'attacker' else url_for('start'))
    # If finished: go straight to result
    if m['status'] == 'finished':
        return redirect(url_for('pvp_result', code=code))
    return render_template('pvp_lobby.html', match=m, role=role)

@app.route('/pvp/start/<code>', methods=['POST'])
def pvp_start(code):
    code = code.upper()
    m = get_match(code)
    if not m:
        return jsonify({'error': 'not_found'}), 404
    if not m['defender_token'] or not m['attacker_token']:
        return jsonify({'error': 'waiting_for_players'}), 400
    # Any participant may start once both present
    role = session.get(f'match:{code}:role')
    if not require_role(code, role):
        return jsonify({'error': 'forbidden'}), 403
    execute_db(
        "UPDATE matches SET status = 'active', started_at = ? WHERE id = ? AND status = 'waiting'",
        (datetime.now().isoformat(), m['id'])
    )
    return jsonify({'ok': True})

@app.route('/pvp/result/<code>')
def pvp_result(code):
    code = code.upper()
    m = get_match(code)
    if not m:
        return redirect(url_for('pvp_landing'))
    role = session.get(f'match:{code}:role')
    return render_template('pvp_result.html', match=m, role=role)

@app.route('/attacker/<code>')
def attacker_console(code):
    code = code.upper()
    m = require_role(code, 'attacker')
    if not m:
        return redirect(url_for('pvp_landing'))
    if m['status'] == 'waiting':
        return redirect(url_for('pvp_lobby', code=code))
    if m['status'] == 'finished':
        return redirect(url_for('pvp_result', code=code))
    return render_template('attacker.html', match=m, effects=ATTACK_EFFECTS)

# ---- JSON APIs ----

@app.route('/api/match/<code>/state')
def api_match_state(code):
    code = code.upper()
    m = get_match(code)
    if not m:
        return jsonify({'error': 'not_found'}), 404
    role = session.get(f'match:{code}:role')
    if not require_role(code, role):
        return jsonify({'error': 'forbidden'}), 403
    return jsonify({
        'code': code,
        'status': m['status'],
        'defender_joined': bool(m['defender_token']),
        'attacker_joined': bool(m['attacker_token']),
        'defender_stage': m['defender_stage'],
        'winner': m['winner'],
        'loss_reason': m['loss_reason'],
        'my_role': role,
    })

@app.route('/api/match/<code>/stage', methods=['POST'])
def api_match_stage(code):
    """Defender pings its current stage. Cheap, called on each page load."""
    code = code.upper()
    m = require_role(code, 'defender')
    if not m:
        return jsonify({'error': 'forbidden'}), 403
    stage = (request.get_json(silent=True) or {}).get('stage') or request.form.get('stage')
    if stage:
        execute_db('UPDATE matches SET defender_stage = ? WHERE id = ?', (stage, m['id']))
    return jsonify({'ok': True})

@app.route('/api/match/<code>/effects')
def api_match_effects(code):
    """Defender polls for unconsumed effects and marks them consumed atomically."""
    code = code.upper()
    m = require_role(code, 'defender')
    if not m:
        return jsonify({'error': 'forbidden'}), 403
    rows = query_db(
        'SELECT id, effect_type, payload FROM match_effects '
        'WHERE match_id = ? AND consumed = 0 ORDER BY id ASC',
        (m['id'],)
    )
    out = []
    for r in rows:
        out.append({'id': r['id'], 'type': r['effect_type'], 'payload': json.loads(r['payload']) if r['payload'] else None})
        execute_db('UPDATE match_effects SET consumed = 1 WHERE id = ?', (r['id'],))
    return jsonify({
        'effects': out,
        'winner': m['winner'],
        'status': m['status'],
    })

@app.route('/api/match/<code>/ability', methods=['POST'])
def api_match_ability(code):
    """Attacker triggers a whitelisted effect. Server enforces cooldown + stage gate."""
    code = code.upper()
    m = require_role(code, 'attacker')
    if not m:
        return jsonify({'error': 'forbidden'}), 403
    if m['status'] != 'active':
        return jsonify({'error': 'match_not_active'}), 400
    body = request.get_json(silent=True) or {}
    eff_type = body.get('type')
    spec = ATTACK_EFFECTS.get(eff_type)
    if not spec:
        return jsonify({'error': 'unknown_effect'}), 400
    # Stage gate
    if spec['stages'] is not None and m['defender_stage'] not in spec['stages']:
        return jsonify({
            'error': 'stage_locked',
            'message': f"Only works while defender is on: {', '.join(sorted(spec['stages']))}.",
            'defender_stage': m['defender_stage'],
        }), 409
    # Cooldown
    cd = query_db(
        'SELECT last_used_at FROM match_cooldowns WHERE match_id = ? AND effect_type = ?',
        (m['id'], eff_type), one=True
    )
    now = datetime.now()
    if cd:
        last = datetime.fromisoformat(cd['last_used_at'])
        remaining = spec['cooldown'] - (now - last).total_seconds()
        if remaining > 0:
            return jsonify({'error': 'cooldown', 'remaining': round(remaining, 1)}), 429
    # Enqueue effect
    execute_db(
        'INSERT INTO match_effects (match_id, effect_type, payload, created_at) VALUES (?, ?, ?, ?)',
        (m['id'], eff_type, None, now.isoformat())
    )
    # Record cooldown (upsert)
    execute_db(
        'INSERT INTO match_cooldowns (match_id, effect_type, last_used_at) VALUES (?, ?, ?) '
        'ON CONFLICT(match_id, effect_type) DO UPDATE SET last_used_at = excluded.last_used_at',
        (m['id'], eff_type, now.isoformat())
    )
    return jsonify({'ok': True, 'cooldown': spec['cooldown']})

@app.route('/api/match/<code>/cooldowns')
def api_match_cooldowns(code):
    """Attacker polls per-ability remaining cooldowns + defender stage."""
    code = code.upper()
    m = require_role(code, 'attacker')
    if not m:
        return jsonify({'error': 'forbidden'}), 403
    rows = query_db('SELECT effect_type, last_used_at FROM match_cooldowns WHERE match_id = ?', (m['id'],))
    now = datetime.now()
    cds = {}
    for r in rows:
        spec = ATTACK_EFFECTS.get(r['effect_type'])
        if not spec: continue
        last = datetime.fromisoformat(r['last_used_at'])
        remaining = spec['cooldown'] - (now - last).total_seconds()
        cds[r['effect_type']] = max(0, round(remaining, 1))
    return jsonify({
        'cooldowns': cds,
        'defender_stage': m['defender_stage'],
        'status': m['status'],
        'winner': m['winner'],
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)

