from bs4 import BeautifulSoup
import urllib.request
from pymongo import MongoClient

def get_content(block, class_):
  str = block.find('p', class_=class_).get_text()
  str = str.replace('\xa0', ' ')
  str = str.replace('\n', '')
  return str

def scrape():
  courses = []
  url = "http://catalog.uta.edu/engineering/computer/#courseinventory"

  req = urllib.request.Request(url)
  resp = urllib.request.urlopen(req)
  html = resp.read().decode('utf-8')

  soup = BeautifulSoup(html)

  for block in soup.find_all('div', class_='courseblock'):
    course = {
      'title': get_content(block, 'courseblocktitle'),
      'desc': get_content(block, 'courseblockdesc')
    }
    courses.append(course)

  return courses

def upload(courses):
  client = MongoClient("<MONGODB CONNECTION STRING>")
  db = client.cse
  
  result = db.course_catalog.insert_many(courses)

  print(result)

courses = scrape()
upload(courses)