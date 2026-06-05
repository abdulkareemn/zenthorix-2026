import sys
import os

# Adjust paths to make app importable
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app

def test_results_layout():
    client = app.test_client()
    
    # Configure session for a logged in student
    with client.session_transaction() as sess:
        sess['role'] = 'student'
        sess['user_id'] = 1
        sess['name'] = 'Abhishek'

    response = client.get('/student/results')
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    
    html = response.data.decode('utf-8')
    
    # Verify the order of columns in the dashboard-grid container
    # "Completed Scores" should come before "Proctor Review Status" in the DOM
    completed_scores_index = html.find('Completed Scores')
    proctor_review_index = html.find('Proctor Review Status')
    
    print("Completed Scores index:", completed_scores_index)
    print("Proctor Review Status index:", proctor_review_index)
    
    if completed_scores_index == -1:
        print("[FAIL] 'Completed Scores' not found in HTML.")
        sys.exit(1)
    if proctor_review_index == -1:
        print("[FAIL] 'Proctor Review Status' not found in HTML.")
        sys.exit(1)
        
    # Verify sidebar logo presence
    logo_tag = 'src="/static/zenthorix-logo.png?v=4"'
    logo_class = 'class="sidebar-logo"'
    
    if logo_tag not in html:
        print("[FAIL] Sidebar logo image tag not found in HTML.")
        sys.exit(1)
    if logo_class not in html:
        print("[FAIL] Sidebar logo image tag does not have 'sidebar-logo' class.")
        sys.exit(1)
        
    print("[OK] Sidebar logo image tag and class verified successfully.")

    if completed_scores_index < proctor_review_index:
        print("[OK] 'Completed Scores' appears before 'Proctor Review Status' on the page.")
        sys.exit(0)
    else:
        print("[FAIL] 'Proctor Review Status' appears before 'Completed Scores'.")
        sys.exit(1)

if __name__ == '__main__':
    test_results_layout()
