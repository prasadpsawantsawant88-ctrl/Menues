-- =====================================================================
-- DineFlow – seed data for "Menues" (run AFTER DATABASE_SCHEMA.sql)
-- Mirrors src/lib/seed.js: 10 tables, 4 kitchen stations, 6 categories, 29 dishes.
-- The local demo seeds itself automatically; this file is for a Postgres/Supabase setup.
-- =====================================================================
insert into restaurant_settings(id) values (1) on conflict do nothing;

insert into kitchen_stations(id, name, chefs) values
  ('grill','Grill',2), ('curry','Curry',2), ('bread','Bread',2), ('beverage','Beverage',2)
on conflict do nothing;

insert into tables(id, capacity, zone) values
  ('T01',2,'Indoor'),('T02',2,'Indoor'),('T03',2,'Window'),('T04',4,'Indoor'),('T05',4,'Indoor'),
  ('T06',4,'Window'),('T07',4,'Outdoor'),('T08',6,'Indoor'),('T09',6,'Outdoor'),('T10',8,'Indoor')
on conflict do nothing;

insert into menu_categories(name, sort_order) values
  ('Starters',0),('Main Course',1),('Indian Breads',2),('Rice and Biryani',3),('Beverages',4),('Desserts',5)
on conflict do nothing;

insert into menu_items(category_id, station_id, name, description, is_veg, price, prep_minutes, complexity)
select c.id, v.station, v.name, v.descr, v.veg, v.price, v.prep, v.cx
from (values
  ('Starters','grill','Paneer Tikka','Cottage cheese marinated in spiced yoghurt, charred in the tandoor.',true,240,15,3),
  ('Starters','grill','Hara Bhara Kebab','Spinach and green pea patties with warm spices.',true,200,14,2),
  ('Starters','grill','Chicken Tikka','Boneless chicken, saffron marinade, tandoor roasted.',false,290,16,3),
  ('Starters','grill','Fish Amritsari','Crisp batter-fried fish with ajwain and lemon.',false,310,14,3),
  ('Starters','grill','Crispy Corn','Golden corn tossed with pepper and spring onion.',true,170,9,1),
  ('Starters','grill','Veg Spring Roll','Crunchy rolls with sweet chilli dip.',true,180,10,2),
  ('Main Course','curry','Dal Makhani','Black lentils slow-cooked overnight with butter and cream.',true,190,18,3),
  ('Main Course','curry','Paneer Butter Masala','Cottage cheese in a silky tomato-butter gravy.',true,230,15,2),
  ('Main Course','curry','Kadai Paneer','Peppers and paneer in a freshly ground kadai masala.',true,240,15,2),
  ('Main Course','curry','Palak Paneer','Paneer in a smooth spinach gravy.',true,220,14,2),
  ('Main Course','curry','Mixed Veg Curry','Seasonal vegetables in a home-style gravy.',true,180,12,1),
  ('Main Course','curry','Butter Chicken','Tandoori chicken in a creamy tomato gravy.',false,310,18,3),
  ('Main Course','curry','Mutton Rogan Josh','Slow-braised mutton with Kashmiri chilli.',false,380,28,4),
  ('Indian Breads','bread','Butter Naan','Soft tandoor-baked bread brushed with butter.',true,45,6,1),
  ('Indian Breads','bread','Garlic Naan','Naan topped with roasted garlic and coriander.',true,60,6,1),
  ('Indian Breads','bread','Tandoori Roti','Whole wheat roti from the tandoor.',true,30,5,1),
  ('Indian Breads','bread','Laccha Paratha','Flaky layered whole wheat paratha.',true,55,7,2),
  ('Indian Breads','bread','Stuffed Kulcha','Kulcha stuffed with spiced potato and onion.',true,80,8,2),
  ('Rice and Biryani','curry','Veg Biryani','Basmati rice layered with vegetables and saffron.',true,220,18,3),
  ('Rice and Biryani','curry','Chicken Biryani','Dum-cooked biryani with marinated chicken.',false,290,22,4),
  ('Rice and Biryani','curry','Jeera Rice','Basmati rice tempered with cumin.',true,120,10,1),
  ('Rice and Biryani','curry','Steamed Rice','Plain steamed basmati rice.',true,100,8,1),
  ('Beverages','beverage','Cold Coffee','Chilled coffee blended with milk.',true,120,4,1),
  ('Beverages','beverage','Masala Chai','Spiced Indian tea.',true,50,4,1),
  ('Beverages','beverage','Fresh Lime Soda','Sweet, salted or mixed.',true,80,3,1),
  ('Beverages','beverage','Mango Lassi','Thick yoghurt drink with Alphonso mango.',true,110,4,1),
  ('Desserts','beverage','Gulab Jamun','Warm milk dumplings in rose syrup (2 pcs).',true,90,4,1),
  ('Desserts','beverage','Rasmalai','Soft cottage cheese discs in saffron milk.',true,120,5,1),
  ('Desserts','beverage','Brownie with Ice Cream','Warm chocolate brownie with vanilla ice cream.',true,160,6,2)
) as v(cat, station, name, descr, veg, price, prep, cx)
join menu_categories c on c.name = v.cat
on conflict do nothing;

