from flask import Flask, session, request, jsonify

app = Flask(__name__)
app.secret_key = 'your_secret_key'

# Simulate a database session
class DatabaseSession:
    def __init__(self):
        self.notifications = set()

    def add_notification(self, notification_id):
        self.notifications.add(notification_id)

    def remove_notification(self, notification_id):
        self.notifications.discard(notification_id)

    def get_notifications(self):
        return self.notifications

db_session = DatabaseSession()

@app.route('/update_asset', methods=['POST'])
def update_asset():
    try:
        # Assuming 'user_id' is the identifier for the user making the change
        user_id = session.get('user_id')
        if not user_id:
            raise PermissionError("User is not logged in.")

        # Assuming 'asset_id' is the identifier for the asset being updated
        asset_id = request.form.get('asset_id')
        if not asset_id:
            raise ValueError("Asset ID is missing.")

        # Perform asset update logic here...

        # Add notification to the database session
        db_session.add_notification(f"Asset {asset_id} updated by {user_id}")

        return jsonify({"message": "Asset updated successfully"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/get_notifications', methods=['GET'])
def get_notifications():
    try:
        user_id = session.get('user_id')
        if not user_id:
            raise PermissionError("User is not logged in.")

        # Get notifications from the database session
        notifications = db_session.get_notifications()

        # Filter out notifications not related to the current user
        user_notifications = [notification for notification in notifications if user_id in notification]

        return jsonify({"notifications": user_notifications}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# Test cases
def test_update_asset():
    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess['user_id'] = 'user1'
        response = client.post('/update_asset', data={'asset_id': '123'})
        assert response.status_code == 200
        assert "Asset updated successfully" in response.json['message']

def test_get_notifications():
    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess['user_id'] = 'user1'
        # Simulate asset update
        client.post('/update_asset', data={'asset_id': '123'})
        # Fetch notifications
        response = client.get('/get_notifications')
        assert response.status_code == 200
        assert "Asset 123 updated by user1" in response.json['notifications']

if __name__ == '__main__':
    test_update_asset()
    test_get_notifications()
    app.run(debug=True)