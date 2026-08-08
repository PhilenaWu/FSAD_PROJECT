// Contact directory — the estate and emergency numbers, from the database
// rather than a literal in the page. Staff numbers come from userService's
// listContacts instead, since those live on the profile row.
import api from './api';

export function listDirectory() {
  return api.get('/api/contacts');
}
