import os
import sqlite3
import json
import time
import subprocess
import shutil
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, g

app = Flask(__name__)
app.secret_key = 'proctor_ai_super_secret_key_12345'

@app.template_filter('json_loads')
def json_loads_filter(s):
    if not s:
        return {}
    try:
        return json.loads(s)
    except:
        return {}

DATABASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database.db')
SANDBOX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sandbox')

# Make sure sandbox dir exists
os.makedirs(SANDBOX_DIR, exist_ok=True)

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        
        # Users Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending'
            )
        ''')
        
        # Exams Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS exams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                duration_mins INTEGER NOT NULL,
                total_marks INTEGER NOT NULL,
                rules_json TEXT NOT NULL,
                questions_json TEXT NOT NULL,
                status TEXT DEFAULT 'published'
            )
        ''')
        
        # Exam Attempts Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS exam_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exam_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT,
                answers_json TEXT,
                score INTEGER DEFAULT 0,
                status TEXT DEFAULT 'ongoing',
                warnings_count INTEGER DEFAULT 0,
                FOREIGN KEY (exam_id) REFERENCES exams (id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        
        # Proctor Logs Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS proctor_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                attempt_id INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                description TEXT NOT NULL,
                FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id)
            )
        ''')
        
        # Live Sessions Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS live_sessions (
                attempt_id INTEGER PRIMARY KEY,
                last_ping REAL NOT NULL,
                current_status TEXT NOT NULL,
                webcam_frame TEXT,
                screen_status TEXT,
                FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id)
            )
        ''')
        
        # System Settings Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS system_settings (
                webcam_required INTEGER,
                audio_required INTEGER,
                max_warnings INTEGER,
                auto_submit INTEGER
            )
        ''')
        
        # Seed default users if empty
        cursor.execute("SELECT COUNT(*) FROM users")
        if cursor.fetchone()[0] == 0:
            cursor.execute("INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)",
                           ('Admin User', 'admin@proctor.ai', 'admin123', 'admin', 'approved'))
            cursor.execute("INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)",
                           ('Abhishek', 'student@proctor.ai', 'student123', 'student', 'approved'))
            db.commit()
            
        # Seed default settings if empty
        cursor.execute("SELECT COUNT(*) FROM system_settings")
        if cursor.fetchone()[0] == 0:
            cursor.execute("INSERT INTO system_settings VALUES (1, 1, 3, 1)")
            db.commit()
            
        # Seed default exams if empty
        cursor.execute("SELECT COUNT(*) FROM exams")
        if cursor.fetchone()[0] == 0:
            default_rules = {
                "webcam_enforcement": True,
                "audio_monitoring": True,
                "max_tab_switches": 3,
                "auto_submit": True,
                "randomize_questions": True
            }
            default_questions = [
                {
                    "id": 1,
                    "title": "Question 1",
                    "difficulty": "Medium",
                    "description": "Write a Java program to print \"Hello World\". Make sure to use the exact public class name as Main and print the output.",
                    "sample_input": "No Input",
                    "expected_output": "Hello World",
                    "template": "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        // Write your code here\n        System.out.println(\"Hello World\");\n    }\n}"
                }
            ]
            cursor.execute("INSERT INTO exams (name, duration_mins, total_marks, rules_json, questions_json, status) VALUES (?, ?, ?, ?, ?, ?)",
                           ('CPA ASSESSMENT', 30, 100, json.dumps(default_rules), json.dumps(default_questions), 'published'))
            cursor.execute("INSERT INTO exams (name, duration_mins, total_marks, rules_json, questions_json, status) VALUES (?, ?, ?, ?, ?, ?)",
                           ('Java Basics', 45, 100, json.dumps(default_rules), json.dumps(default_questions), 'published'))
            db.commit()

        db.commit()

# Initialize Database on load
init_db()

# HELPER: Get active attempt for student
def get_active_attempt(user_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM exam_attempts WHERE user_id = ? AND status = 'ongoing' ORDER BY id DESC LIMIT 1", (user_id,))
    return cursor.fetchone()

# ROUTES

@app.route('/')
def index():
    if 'user_id' in session:
        if session['role'] == 'admin':
            return redirect(url_for('admin_dashboard'))
        else:
            return redirect(url_for('student_dashboard'))
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        role = request.form.get('role')
        
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ? AND password = ? AND role = ?", (email, password, role))
        user = cursor.fetchone()
        
        if user:
            if user['status'] != 'approved' and user['role'] == 'student':
                return render_template('login.html', error="Your account status is: " + user['status'] + ". Please wait for admin approval.")
            
            session['user_id'] = user['id']
            session['name'] = user['name']
            session['email'] = user['email']
            session['role'] = user['role']
            
            if user['role'] == 'admin':
                return redirect(url_for('admin_dashboard'))
            else:
                return redirect(url_for('student_dashboard'))
        else:
            return render_template('login.html', error="Invalid email, password, or role selection.")
            
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    name = request.form.get('name')
    email = request.form.get('email')
    password = request.form.get('password')
    
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, 'student', 'approved')", (name, email, password))
        db.commit()
        return render_template('login.html', success="Registration successful! You can now log in.")
    except sqlite3.IntegrityError:
        return render_template('login.html', error="Email address already registered.")

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# ADMIN ROUTES

@app.route('/admin/dashboard')
def admin_dashboard():
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'student'")
    total_candidates = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM exams")
    total_exams = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
    total_users = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM exam_attempts WHERE status = 'submitted'")
    total_results = cursor.fetchone()[0]
    
    # Recent alerts
    cursor.execute('''
        SELECT l.*, u.name as candidate_name, e.name as exam_name 
        FROM proctor_logs l
        JOIN exam_attempts a ON l.attempt_id = a.id
        JOIN users u ON a.user_id = u.id
        JOIN exams e ON a.exam_id = e.id
        ORDER BY l.id DESC LIMIT 5
    ''')
    recent_alerts = cursor.fetchall()
    
    # Active live counts
    now = time.time()
    cursor.execute("SELECT COUNT(*) FROM live_sessions WHERE last_ping > ?", (now - 10,))
    active_live = cursor.fetchone()[0]

    return render_template('admin_dashboard.html', 
                           total_candidates=total_candidates,
                           total_exams=total_exams,
                           total_users=total_users,
                           total_results=total_results,
                           recent_alerts=recent_alerts,
                           active_live=active_live)

@app.route('/admin/candidates')
def admin_candidates():
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM users WHERE role = 'student'")
    candidates = cursor.fetchall()
    return render_template('admin_candidates.html', candidates=candidates)

@app.route('/admin/candidates/approve/<int:user_id>')
def approve_candidate(user_id):
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute("UPDATE users SET status = 'approved' WHERE id = ?", (user_id,))
    db.commit()
    return redirect(url_for('admin_candidates'))

@app.route('/admin/candidates/reject/<int:user_id>')
def reject_candidate(user_id):
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute("UPDATE users SET status = 'rejected' WHERE id = ?", (user_id,))
    db.commit()
    return redirect(url_for('admin_candidates'))

@app.route('/admin/exams')
def admin_exams():
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM exams")
    exams = cursor.fetchall()
    return render_template('admin_exams.html', exams=exams)

@app.route('/admin/exams/create', methods=['POST'])
def create_exam():
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    name = request.form.get('exam_name')
    duration = int(request.form.get('duration'))
    marks = int(request.form.get('marks'))
    
    webcam = True if request.form.get('webcam') else False
    audio = True if request.form.get('audio') else False
    max_tabs = int(request.form.get('max_tabs', 3))
    auto_submit = True if request.form.get('auto_submit') else False
    randomize = True if request.form.get('randomize') else False
    
    rules = {
        "webcam_enforcement": webcam,
        "audio_monitoring": audio,
        "max_tab_switches": max_tabs,
        "auto_submit": auto_submit,
        "randomize_questions": randomize
    }
    
    # Simple default coding question
    q_title = request.form.get('question_title', 'Question 1')
    q_desc = request.form.get('question_desc', 'Write a program to add two numbers.')
    q_template = request.form.get('question_template', 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello World");\n    }\n}')
    q_expected = request.form.get('question_expected', 'Hello World')
    
    questions = [
        {
            "id": 1,
            "title": q_title,
            "difficulty": "Medium",
            "description": q_desc,
            "sample_input": "No Input",
            "expected_output": q_expected,
            "template": q_template
        }
    ]
    
    db = get_db()
    cursor = db.cursor()
    cursor.execute("INSERT INTO exams (name, duration_mins, total_marks, rules_json, questions_json) VALUES (?, ?, ?, ?, ?)",
                   (name, duration, marks, json.dumps(rules), json.dumps(questions)))
    db.commit()
    return redirect(url_for('admin_exams'))

@app.route('/admin/exams/delete/<int:exam_id>')
def delete_exam(exam_id):
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute("DELETE FROM exams WHERE id = ?", (exam_id,))
    db.commit()
    return redirect(url_for('admin_exams'))

@app.route('/admin/live')
def admin_live():
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    return render_template('admin_live.html')

@app.route('/admin/live/sessions')
def active_sessions_api():
    if session.get('role') != 'admin':
        return jsonify({"error": "Unauthorized"}), 401
        
    db = get_db()
    cursor = db.cursor()
    
    # Active is defined as pinged in the last 15 seconds
    now = time.time()
    cursor.execute('''
        SELECT s.*, u.name as student_name, e.name as exam_name, a.warnings_count, a.id as attempt_id
        FROM live_sessions s
        JOIN exam_attempts a ON s.attempt_id = a.id
        JOIN users u ON a.user_id = u.id
        JOIN exams e ON a.exam_id = e.id
        WHERE s.last_ping > ?
    ''', (now - 15,))
    
    sessions = []
    for row in cursor.fetchall():
        # Get last 3 logs for this session
        cursor.execute("SELECT alert_type, description, timestamp FROM proctor_logs WHERE attempt_id = ? ORDER BY id DESC LIMIT 3", (row['attempt_id'],))
        recent_logs = [dict(log) for log in cursor.fetchall()]
        
        sessions.append({
            "attempt_id": row['attempt_id'],
            "student_name": row['student_name'],
            "exam_name": row['exam_name'],
            "warnings_count": row['warnings_count'],
            "webcam_frame": row['webcam_frame'],
            "screen_status": row['screen_status'],
            "current_status": row['current_status'],
            "recent_logs": recent_logs
        })
        
    return jsonify(sessions)

@app.route('/admin/reports')
def admin_reports():
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        SELECT a.id as attempt_id, a.start_time, a.end_time, a.score, a.warnings_count, a.status,
               u.name as student_name, u.email as student_email, e.name as exam_name
        FROM exam_attempts a
        JOIN users u ON a.user_id = u.id
        JOIN exams e ON a.exam_id = e.id
        WHERE a.status = 'submitted' OR a.status = 'reviewed'
        ORDER BY a.id DESC
    ''')
    reports = cursor.fetchall()
    return render_template('admin_reports.html', reports=reports)

@app.route('/admin/reports/<int:attempt_id>')
def admin_report_details(attempt_id):
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        SELECT a.*, u.name as student_name, u.email as student_email, e.name as exam_name, e.total_marks
        FROM exam_attempts a
        JOIN users u ON a.user_id = u.id
        JOIN exams e ON a.exam_id = e.id
        WHERE a.id = ?
    ''', (attempt_id,))
    attempt = cursor.fetchone()
    
    if not attempt:
        return redirect(url_for('admin_reports'))
        
    cursor.execute("SELECT * FROM proctor_logs WHERE attempt_id = ? ORDER BY id ASC", (attempt_id,))
    logs = cursor.fetchall()
    
    return render_template('admin_report_detail.html', attempt=attempt, logs=logs)

@app.route('/admin/settings', methods=['GET', 'POST'])
def admin_settings():
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    
    if request.method == 'POST':
        webcam = 1 if request.form.get('webcam') else 0
        audio = 1 if request.form.get('audio') else 0
        max_warnings = int(request.form.get('max_warnings', 3))
        auto_submit = 1 if request.form.get('auto_submit') else 0
        
        # Save to table
        cursor.execute("DELETE FROM system_settings")
        cursor.execute("INSERT INTO system_settings VALUES (?, ?, ?, ?)", (webcam, audio, max_warnings, auto_submit))
        db.commit()
        
        # Update user profile details
        full_name = request.form.get('full_name')
        email = request.form.get('email')
        cursor.execute("UPDATE users SET name = ?, email = ? WHERE id = ?", (full_name, email, session['user_id']))
        db.commit()
        session['name'] = full_name
        session['email'] = email
        
        return render_template('admin_settings.html', success="Settings updated successfully.")
        
    # Get current settings
    cursor.execute("SELECT * FROM system_settings LIMIT 1")
    settings = cursor.fetchone()
    if not settings:
        settings = {"webcam_required": 1, "audio_required": 1, "max_warnings": 3, "auto_submit": 1}
        
    return render_template('admin_settings.html', settings=settings)

# STUDENT PORTAL ROUTES

@app.route('/student/dashboard')
def student_dashboard():
    if session.get('role') != 'student':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    
    # Get all exams
    cursor.execute("SELECT * FROM exams WHERE status = 'published'")
    exams = cursor.fetchall()
    
    # Find exam status for this student
    cursor.execute('''
        SELECT exam_id, status, score FROM exam_attempts 
        WHERE user_id = ?
    ''', (session['user_id'],))
    attempts = {row['exam_id']: {"status": row['status'], "score": row['score']} for row in cursor.fetchall()}
    
    # Recent activity log
    cursor.execute('''
        SELECT e.name as exam_name, a.status, a.end_time 
        FROM exam_attempts a 
        JOIN exams e ON a.exam_id = e.id 
        WHERE a.user_id = ? AND a.status != 'ongoing'
        ORDER BY a.id DESC LIMIT 4
    ''', (session['user_id'],))
    activities = cursor.fetchall()
    
    # Count stats
    total_assigned = len(exams)
    completed_count = sum(1 for e in exams if e['id'] in attempts and attempts[e['id']]['status'] in ('submitted', 'reviewed'))
    pending_count = total_assigned - completed_count
    
    return render_template('student_dashboard.html', 
                           exams=exams, 
                           attempts=attempts, 
                           activities=activities,
                           total_assigned=total_assigned,
                           completed_count=completed_count,
                           pending_count=pending_count)

@app.route('/student/profile')
def student_profile():
    if session.get('role') != 'student':
        return redirect(url_for('login'))
    
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT COUNT(*) FROM exams WHERE status = 'published'")
    published_exams = cursor.fetchone()[0]
    
    return render_template('student_profile.html', published_exams=published_exams)

@app.route('/student/results')
def student_results():
    if session.get('role') != 'student':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        SELECT a.id as attempt_id, a.score, a.status, a.end_time, e.name as exam_name, e.total_marks
        FROM exam_attempts a
        JOIN exams e ON a.exam_id = e.id
        WHERE a.user_id = ? AND a.status != 'ongoing'
    ''', (session['user_id'],))
    results = cursor.fetchall()
    return render_template('student_results.html', results=results)

@app.route('/student/verify/<int:exam_id>')
def student_verify(exam_id):
    if session.get('role') != 'student':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM exams WHERE id = ?", (exam_id,))
    exam = cursor.fetchone()
    
    if not exam:
        return redirect(url_for('student_dashboard'))
        
    return render_template('student_verify.html', exam=exam)

@app.route('/student/exam/<int:exam_id>/instructions')
def student_instructions(exam_id):
    if session.get('role') != 'student':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM exams WHERE id = ?", (exam_id,))
    exam = cursor.fetchone()
    
    if not exam:
        return redirect(url_for('student_dashboard'))
        
    return render_template('student_instructions.html', exam=exam)

@app.route('/student/exam/<int:exam_id>', methods=['GET', 'POST'])
def student_exam(exam_id):
    if session.get('role') != 'student':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM exams WHERE id = ?", (exam_id,))
    exam = cursor.fetchone()
    
    if not exam:
        return redirect(url_for('student_dashboard'))
        
    # Check if there is already an ongoing attempt
    attempt = get_active_attempt(session['user_id'])
    if not attempt:
        # Create a new attempt
        start_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute('''
            INSERT INTO exam_attempts (exam_id, user_id, start_time, status)
            VALUES (?, ?, ?, 'ongoing')
        ''', (exam_id, session['user_id'], start_time_str))
        db.commit()
        
        cursor.execute("SELECT last_insert_rowid()")
        attempt_id = cursor.fetchone()[0]
        
        # Insert initial live session
        cursor.execute('''
            INSERT OR REPLACE INTO live_sessions (attempt_id, last_ping, current_status, screen_status)
            VALUES (?, ?, ?, ?)
        ''', (attempt_id, time.time(), 'started', 'shared'))
        db.commit()
        
        # Reload attempt
        cursor.execute("SELECT * FROM exam_attempts WHERE id = ?", (attempt_id,))
        attempt = cursor.fetchone()
        
    # Calculate time remaining
    start_dt = datetime.strptime(attempt['start_time'], "%Y-%m-%d %H:%M:%S")
    elapsed_seconds = (datetime.now() - start_dt).total_seconds()
    time_limit_seconds = exam['duration_mins'] * 60
    time_remaining_seconds = max(0, int(time_limit_seconds - elapsed_seconds))
    
    if time_remaining_seconds == 0:
        # Auto submit
        return redirect(url_for('submit_exam', exam_id=exam_id))

    questions = json.loads(exam['questions_json'])
    rules = json.loads(exam['rules_json'])
    
    return render_template('student_exam.html', 
                           exam=exam, 
                           attempt=attempt, 
                           questions=questions, 
                           rules=rules, 
                           time_remaining=time_remaining_seconds)

# API ENDPOINTS

@app.route('/student/exam/<int:exam_id>/run', methods=['POST'])
def run_code(exam_id):
    if session.get('role') != 'student':
        return jsonify({"error": "Unauthorized"}), 401
        
    code = request.json.get('code')
    input_data = request.json.get('input', '')
    
    # Save files to a unique temporary folder in sandbox
    attempt = get_active_attempt(session['user_id'])
    attempt_id = attempt['id'] if attempt else 0
    
    timestamp = int(time.time() * 1000)
    run_dir = os.path.join(SANDBOX_DIR, f"run_{attempt_id}_{timestamp}")
    os.makedirs(run_dir, exist_ok=True)
    
    java_file = os.path.join(run_dir, "Main.java")
    with open(java_file, 'w', encoding='utf-8') as f:
        f.write(code)
        
    try:
        # Compile Java
        compile_process = subprocess.run(
            ['javac', 'Main.java'],
            cwd=run_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10
        )
        
        if compile_process.returncode != 0:
            return jsonify({
                "status": "error",
                "compiler_error": compile_process.stderr
            })
            
        # Run Java
        run_process = subprocess.run(
            ['java', 'Main'],
            cwd=run_dir,
            input=input_data,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5
        )
        
        return jsonify({
            "status": "success",
            "output": run_process.stdout,
            "error": run_process.stderr
        })
        
    except subprocess.TimeoutExpired:
        return jsonify({
            "status": "error",
            "compiler_error": "Execution Timeout: The program took longer than 5 seconds to run."
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "compiler_error": f"Execution error: {str(e)}"
        })
    finally:
        # Clean up sandbox folder
        shutil.rmtree(run_dir, ignore_errors=True)

@app.route('/student/exam/<int:exam_id>/ping', methods=['POST'])
def ping_session(exam_id):
    if session.get('role') != 'student':
        return jsonify({"error": "Unauthorized"}), 401
        
    webcam_frame = request.json.get('webcam_frame')
    screen_status = request.json.get('screen_status', 'shared')
    current_status = request.json.get('current_status', 'active')
    
    attempt = get_active_attempt(session['user_id'])
    if not attempt:
        return jsonify({"status": "ended"})
        
    db = get_db()
    cursor = db.cursor()
    
    # Update ping
    cursor.execute('''
        INSERT OR REPLACE INTO live_sessions (attempt_id, last_ping, current_status, webcam_frame, screen_status)
        VALUES (?, ?, ?, ?, ?)
    ''', (attempt['id'], time.time(), current_status, webcam_frame, screen_status))
    db.commit()
    
    return jsonify({"status": "ok"})

@app.route('/student/exam/<int:exam_id>/log_alert', methods=['POST'])
def log_alert(exam_id):
    if session.get('role') != 'student':
        return jsonify({"error": "Unauthorized"}), 401
        
    alert_type = request.json.get('alert_type')
    description = request.json.get('description')
    
    attempt = get_active_attempt(session['user_id'])
    if not attempt:
        return jsonify({"error": "No active attempt"}), 400
        
    db = get_db()
    cursor = db.cursor()
    
    # Insert proctor log
    timestamp_str = datetime.now().strftime("%I:%M:%S %p")
    cursor.execute('''
        INSERT INTO proctor_logs (attempt_id, timestamp, alert_type, description)
        VALUES (?, ?, ?, ?)
    ''', (attempt['id'], timestamp_str, alert_type, description))
    
    # Increment warnings count
    cursor.execute('UPDATE exam_attempts SET warnings_count = warnings_count + 1 WHERE id = ?', (attempt['id'],))
    db.commit()
    
    # Reload attempt warnings count
    cursor.execute('SELECT warnings_count FROM exam_attempts WHERE id = ?', (attempt['id'],))
    warnings_count = cursor.fetchone()[0]
    
    return jsonify({"status": "logged", "warnings_count": warnings_count})

@app.route('/student/exam/<int:exam_id>/submit', methods=['GET', 'POST'])
def submit_exam(exam_id):
    if session.get('role') != 'student':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    
    attempt = get_active_attempt(session['user_id'])
    if attempt:
        end_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Calculate Mock Score based on compiler check (e.g. if code ran correctly)
        # In a real tool we'd evaluate unit tests. Here we check answers_json
        code_submitted = request.form.get('code_editor', '')
        answers_json = json.dumps({"q1_code": code_submitted})
        
        # Mocking evaluation
        score = 85  # default
        if "Hello World" in code_submitted:
            score = 100
        elif not code_submitted:
            score = 0
        else:
            score = 60
            
        cursor.execute('''
            UPDATE exam_attempts 
            SET end_time = ?, answers_json = ?, score = ?, status = 'submitted'
            WHERE id = ?
        ''', (end_time_str, answers_json, score, attempt['id']))
        db.commit()
        
        # Remove from live sessions
        cursor.execute("DELETE FROM live_sessions WHERE attempt_id = ?", (attempt['id'],))
        db.commit()
        
    return render_template('student_results.html', submitted=True)

@app.route('/student/exam/<int:exam_id>/upload_recordings', methods=['POST'])
def upload_recordings(exam_id):
    if session.get('role') != 'student':
        return jsonify({"error": "Unauthorized"}), 401
        
    attempt = get_active_attempt(session['user_id'])
    if not attempt:
        # If already submitted, find the latest attempt
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT id FROM exam_attempts WHERE user_id = ? AND exam_id = ? ORDER BY id DESC LIMIT 1", (session['user_id'], exam_id))
        row = cursor.fetchone()
        attempt_id = row['id'] if row else 0
    else:
        attempt_id = attempt['id']
        
    if attempt_id == 0:
        return jsonify({"error": "No attempt found"}), 400
        
    webcam_file = request.files.get('webcam')
    screen_file = request.files.get('screen')
    
    uploads_dir = os.path.join(app.static_folder, 'uploads')
    os.makedirs(uploads_dir, exist_ok=True)
    
    if webcam_file:
        webcam_path = os.path.join(uploads_dir, f"webcam_{attempt_id}.webm")
        webcam_file.save(webcam_path)
        
    if screen_file:
        screen_path = os.path.join(uploads_dir, f"screen_{attempt_id}.webm")
        screen_file.save(screen_path)
        
    return jsonify({"status": "success"})

@app.route('/admin/reports/review/<int:attempt_id>', methods=['POST'])
def review_report(attempt_id):
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute("UPDATE exam_attempts SET status = 'reviewed' WHERE id = ?", (attempt_id,))
    db.commit()
    return redirect(url_for('admin_report_details', attempt_id=attempt_id))

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5173)
