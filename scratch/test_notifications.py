import sys
import os

# Adjust paths to make app importable
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app
import sqlite3

def test_notifications():
    client = app.test_client()
    
    # Configure session for an admin
    with client.session_transaction() as sess:
        sess['role'] = 'admin'
        sess['user_id'] = 2
        sess['name'] = 'Admin User'
        
    # Insert a dummy notification for testing
    db = sqlite3.connect('database.db')
    cursor = db.cursor()
    cursor.execute("SELECT id FROM exam_attempts ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    attempt_id = row[0] if row else 1
    
    cursor.execute('''
        INSERT INTO malpractice_notifications (attempt_id, candidate_name, exam_name, violation_type, description, timestamp, severity, evidence_screenshot, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (attempt_id, 'Test Abhishek', 'Java Basics', 'Tab Switching', 'Candidate switched tabs.', '10:25:00 AM', 'Medium', 'data:image/png;base64,123', 'Active'))
    db.commit()
    alert_id = cursor.lastrowid
    db.close()
    
    print(f"Created test notification with ID: {alert_id}")
    
    # 1. Fetch notifications data
    response = client.get('/admin/notifications/data')
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.get_json()
    assert 'alerts' in data, "No 'alerts' in response data"
    assert 'unread_count' in data, "No 'unread_count' in response data"
    
    alerts = data['alerts']
    unread_count = data['unread_count']
    print(f"Unread count: {unread_count}")
    print(f"Loaded alerts: {len(alerts)}")
    
    # Verify the dummy notification is present
    test_alert = next((a for a in alerts if a['id'] == alert_id), None)
    assert test_alert is not None, "Dummy alert was not found in data API"
    assert test_alert['candidate_name'] == 'Test Abhishek'
    assert test_alert['severity'] == 'Medium'
    assert test_alert['status'] == 'Active'
    print("[OK] Fetching alerts data verified successfully!")
    
    # 2. Mark reviewed action
    res_review = client.post(f'/admin/notifications/action/{alert_id}', json={"action": "mark_reviewed"})
    assert res_review.status_code == 200
    data_review = res_review.get_json()
    assert data_review['status'] == 'success'
    
    # Verify DB status updated
    db = sqlite3.connect('database.db')
    cursor = db.cursor()
    cursor.execute("SELECT status FROM malpractice_notifications WHERE id = ?", (alert_id,))
    status = cursor.fetchone()[0]
    db.close()
    assert status == 'Reviewed', f"Expected Reviewed, got {status}"
    print("[OK] Mark Reviewed action verified successfully!")
    
    # 3. Dismiss action
    res_dismiss = client.post(f'/admin/notifications/action/{alert_id}', json={"action": "dismiss"})
    assert res_dismiss.status_code == 200
    data_dismiss = res_dismiss.get_json()
    assert data_dismiss['status'] == 'success'
    
    # Verify DB status updated
    db = sqlite3.connect('database.db')
    cursor = db.cursor()
    cursor.execute("SELECT status FROM malpractice_notifications WHERE id = ?", (alert_id,))
    status = cursor.fetchone()[0]
    
    # Clean up test notification
    cursor.execute("DELETE FROM malpractice_notifications WHERE id = ?", (alert_id,))
    db.commit()
    db.close()
    
    assert status == 'Dismissed', f"Expected Dismissed, got {status}"
    print("[OK] Dismiss action verified successfully!")
    
    print("[ALL OK] Notifications test script executed successfully without failures.")
    sys.exit(0)

if __name__ == '__main__':
    test_notifications()
